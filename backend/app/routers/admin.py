import logging
import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import case, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import admin_user, get_db
from app.errors import ApiError
from app.models import User, utcnow
from sqlalchemy.exc import IntegrityError

from app.models import AdminAudit
from app.schemas import AdminBulkBody, AdminCreateBody, AdminPasswordBody, AdminPatchBody, iso, user_json
from app.routers.auth import validate_new_password
from app.security import email_is_valid, hash_password, normalize_email
from app.services.quota import log_admin, used_tokens_many
from app.services.sessions import revoke_user_sessions
from app.services.storage import delete_user_objects, user_thumb_keys

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])


def _escape_like(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def _purge_objects(user_id: uuid.UUID, thumbs: list[str]) -> None:
    """Best-effort MinIO cleanup after the DB commit: an orphan object is harmless, a dangling row is not."""
    try:
        await delete_user_objects(user_id, thumbs)
    except Exception:
        log.exception("deleting stored objects of user %s failed", user_id)


async def _get_target(db: AsyncSession, admin: User, user_id: uuid.UUID) -> User:
    target = (await db.execute(select(User).where(User.id == user_id).with_for_update())).scalar_one_or_none()
    if target is None:
        raise ApiError(404, "not_found", "User not found")
    if target.id == admin.id:
        raise ApiError(400, "cannot_modify_self", "You cannot modify your own account here")
    return target


@router.get("/users")
async def list_users(
    q: str | None = None,
    status: str | None = Query(None, pattern="^(pending|active|disabled)$"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    conds = []
    if q and q.strip():
        like = f"%{_escape_like(q.strip())}%"
        conds.append(or_(User.email.ilike(like, escape="\\"), User.display_name.ilike(like, escape="\\")))
    if status:
        conds.append(User.status == status)
    total = (await db.execute(select(func.count()).select_from(User).where(*conds))).scalar_one()
    rows = (
        await db.execute(
            select(User)
            .where(*conds)
            .order_by(case((User.status == "pending", 0), else_=1), User.created_at.desc(), User.id)
            .limit(limit)
            .offset(offset)
        )
    ).scalars()
    users = list(rows)
    used = await used_tokens_many(db, users)
    return {"items": [{**user_json(u), "tokens_used": used[u.id]} for u in users], "total": total}


@router.post("/users", status_code=201)
async def create_user(
    body: AdminCreateBody,
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    email = normalize_email(body.email)
    if not email_is_valid(email):
        raise ApiError(422, "invalid_email", "Invalid email address")
    display_name = body.display_name.strip()
    if not 1 <= len(display_name) <= 80:
        raise ApiError(422, "invalid_display_name", "Display name must be 1-80 characters")
    validate_new_password(body.password, email)
    if (await db.execute(select(User.id).where(func.lower(User.email) == email))).first():
        raise ApiError(409, "email_taken", "This email is already registered")

    user = User(
        email=email,
        display_name=display_name,
        password_hash=await hash_password(body.password),
        role=body.role,
        status=body.status,
    )
    if body.status == "active":
        user.approved_at = utcnow()
        user.approved_by = admin.id
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ApiError(409, "email_taken", "This email is already registered") from None
    log_admin(db, admin, user, "user.create", {"role": user.role, "status": user.status})
    await db.commit()
    return {"user": user_json(user)}


@router.post("/users/bulk")
async def bulk_users(
    body: AdminBulkBody,
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    ids = list(dict.fromkeys(body.ids))
    found = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(ids)).order_by(User.id).with_for_update())).scalars()}
    done: list[str] = []
    skipped: list[dict] = []
    to_delete: list[User] = []
    for uid in ids:
        target = found.get(uid)
        if uid == admin.id:
            skipped.append({"id": str(uid), "reason": "self"})
        elif target is None:
            skipped.append({"id": str(uid), "reason": "not_found"})
        elif not await _apply_bulk(db, admin, target, body.action, to_delete):
            skipped.append({"id": str(uid), "reason": "no_change"})
        else:
            done.append(str(uid))
    thumbs = {t.id: await user_thumb_keys(db, t.id) for t in to_delete}  # file rows vanish with the user
    if to_delete:
        await db.execute(delete(User).where(User.id.in_([t.id for t in to_delete])))
    await db.commit()
    for uid, keys in thumbs.items():
        await _purge_objects(uid, keys)
    return {"done": done, "skipped": skipped}


async def _apply_bulk(db: AsyncSession, admin: User, target: User, action: str, to_delete: list[User]) -> bool:
    """Apply one bulk action to one user; False when it does not apply. Writes the audit row."""
    old_status = target.status
    if action == "delete":
        log_admin(db, admin, target, "user.delete", {"bulk": True})
        to_delete.append(target)
        return True
    if action == "approve" and old_status == "pending":
        new_status = "active"
    elif action == "disable" and old_status in ("pending", "active"):
        new_status = "disabled"
    elif action == "enable" and old_status == "disabled":
        new_status = "active"
    else:
        return False
    if new_status == "active":
        target.approved_at = utcnow()
        target.approved_by = admin.id
    else:
        await revoke_user_sessions(db, target.id)
    target.status = new_status
    target.updated_at = utcnow()
    log_admin(db, admin, target, "user.status", {"from": old_status, "to": new_status, "bulk": True})
    return True


@router.get("/audit")
async def list_audit(
    q: str | None = None,
    action: str | None = Query(None, pattern="^user\\.(create|status|role|password_reset|delete|quota)$"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    conds = []
    if q and q.strip():
        like = f"%{_escape_like(q.strip())}%"
        conds.append(or_(AdminAudit.actor_email.ilike(like, escape="\\"), AdminAudit.target_email.ilike(like, escape="\\")))
    if action:
        conds.append(AdminAudit.action == action)
    total = (await db.execute(select(func.count()).select_from(AdminAudit).where(*conds))).scalar_one()
    rows = (
        await db.execute(
            select(AdminAudit)
            .where(*conds)
            .order_by(AdminAudit.created_at.desc(), AdminAudit.id)
            .limit(limit)
            .offset(offset)
        )
    ).scalars()
    items = [
        {
            "id": str(a.id),
            "actor_id": str(a.actor_id) if a.actor_id else None,
            "actor_email": a.actor_email,
            "target_id": str(a.target_id) if a.target_id else None,
            "target_email": a.target_email,
            "action": a.action,
            "detail": a.detail,
            "created_at": iso(a.created_at),
        }
        for a in rows
    ]
    return {"items": items, "total": total}


@router.patch("/users/{user_id}")
async def patch_user(
    user_id: uuid.UUID,
    body: AdminPatchBody,
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    target = await _get_target(db, admin, user_id)
    if body.role is not None and body.role != target.role:
        log_admin(db, admin, target, "user.role", {"from": target.role, "to": body.role})
        target.role = body.role
    if body.status is not None and body.status != target.status:
        log_admin(db, admin, target, "user.status", {"from": target.status, "to": body.status})
        if body.status == "active":
            target.approved_at = utcnow()
            target.approved_by = admin.id
        elif body.status == "disabled":
            await revoke_user_sessions(db, target.id)
        target.status = body.status
    old = {"limit": target.token_limit, "period": target.token_period}
    new = dict(old)
    if "token_limit" in body.model_fields_set:
        new["limit"] = body.token_limit
    if body.token_period is not None:
        new["period"] = body.token_period
    if new != old:
        target.token_limit, target.token_period = new["limit"], new["period"]
        log_admin(db, admin, target, "user.quota", {"from": old, "to": new})
    target.updated_at = utcnow()
    await db.commit()
    return {"user": user_json(target)}


@router.post("/users/{user_id}/password", status_code=204)
async def reset_password(
    user_id: uuid.UUID,
    body: AdminPasswordBody,
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    target = await _get_target(db, admin, user_id)
    validate_new_password(body.new_password, target.email)
    target.password_hash = await hash_password(body.new_password)
    await revoke_user_sessions(db, target.id)
    log_admin(db, admin, target, "user.password_reset", {})
    await db.commit()
    return Response(status_code=204)


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: uuid.UUID,
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    target = await _get_target(db, admin, user_id)
    log_admin(db, admin, target, "user.delete", {})
    thumbs = await user_thumb_keys(db, target.id)  # file rows vanish with the user
    await db.execute(delete(User).where(User.id == target.id))
    await db.commit()
    await _purge_objects(target.id, thumbs)
    return Response(status_code=204)

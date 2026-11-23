import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import case, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import admin_user, get_db
from app.errors import ApiError
from app.models import User, utcnow
from app.schemas import AdminPasswordBody, AdminPatchBody, user_json
from app.routers.auth import validate_new_password
from app.security import hash_password
from app.services.sessions import revoke_user_sessions
from app.services.storage import delete_user_objects

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _escape_like(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def _get_target(db: AsyncSession, admin: User, user_id: uuid.UUID) -> User:
    target = await db.get(User, user_id)
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
    return {"items": [user_json(u) for u in rows], "total": total}


@router.patch("/users/{user_id}")
async def patch_user(
    user_id: uuid.UUID,
    body: AdminPatchBody,
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    target = await _get_target(db, admin, user_id)
    if body.role is not None:
        target.role = body.role
    if body.status is not None and body.status != target.status:
        if body.status == "active":
            target.approved_at = utcnow()
            target.approved_by = admin.id
        elif body.status == "disabled":
            await revoke_user_sessions(db, target.id)
        target.status = body.status
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
    await db.commit()
    return Response(status_code=204)


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: uuid.UUID,
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    target = await _get_target(db, admin, user_id)
    await delete_user_objects(target.id)
    await db.execute(delete(User).where(User.id == target.id))
    await db.commit()
    return Response(status_code=204)

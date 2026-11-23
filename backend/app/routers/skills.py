import asyncio
import logging
import mimetypes
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import active_user
from app.errors import ApiError
from app.models import Skill, User
from app.routers.files import read_upload
from app.schemas import iso
from app.services import skills as skill_svc
from app.services import storage

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/skills", tags=["skills"])


class PatchSkill(BaseModel):
    model_config = ConfigDict(extra="ignore")
    enabled: bool


def skill_json(s: Skill) -> dict:
    return {
        "id": str(s.id),
        "name": s.name,
        "description": s.description,
        "version": s.version,
        "enabled": s.enabled,
        "size": s.size,
        "file_count": len(s.files or []),
        "created_at": iso(s.created_at),
        "updated_at": iso(s.updated_at),
    }


def _prefix(user_id: uuid.UUID, skill_id: uuid.UUID) -> str:
    return f"u/{user_id}/skills/{skill_id}/"


async def _drop_prefix(prefix: str) -> None:
    try:
        await storage.delete_prefix(prefix)
    except Exception:
        log.warning("could not delete skill objects under %s", prefix, exc_info=True)


async def _owned(db: AsyncSession, user: User, skill_id: uuid.UUID) -> Skill:
    s = await db.get(Skill, skill_id)
    if s is None or s.user_id != user.id:
        raise ApiError(404, "not_found", "Skill not found")
    return s


@router.get("")
async def list_skills(user: User = Depends(active_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Skill).where(Skill.user_id == user.id).order_by(Skill.name))).scalars()
    return {"items": [skill_json(s) for s in rows]}


@router.post("", status_code=201)
async def upload_skill(
    request: Request, replace: bool = False, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)
):
    up = await read_upload(request, skill_svc.MAX_UPLOAD_BYTES)
    try:
        if up.file is None or not (up.filename or "").strip():
            raise ApiError(422, "invalid_skill", "Upload a SKILL.md file or a .zip archive in the 'file' field")
        up.file.seek(0)
        data = await asyncio.to_thread(up.file.read)
    finally:
        up.close()
    try:
        parsed = await asyncio.to_thread(skill_svc.parse_upload, up.filename or "", data)
    except skill_svc.InvalidSkill as e:
        raise ApiError(422, "invalid_skill", str(e)) from None

    existing = (
        await db.execute(select(Skill).where(Skill.user_id == user.id, Skill.name == parsed.name))
    ).scalar_one_or_none()
    if existing is not None and not replace:
        raise ApiError(409, "skill_exists", f"A skill named {parsed.name!r} already exists")

    # 1. upload under the new id's prefix, 2. swap the DB rows in one commit, 3. drop the old objects.
    # A failure before step 2 leaves the old skill (rows and objects) untouched.
    new_id = uuid.uuid4()
    prefix = _prefix(user.id, new_id)
    old_prefix = _prefix(user.id, existing.id) if existing is not None else None
    skill = Skill(
        id=new_id,
        user_id=user.id,
        name=parsed.name,
        description=parsed.description,
        version=parsed.version,
        enabled=existing.enabled if existing is not None else True,
        size=parsed.size,
        files=[{"path": p, "size": len(c)} for p, c in sorted(parsed.files.items())],
    )
    try:
        for path, content in parsed.files.items():
            await storage.put_object(prefix + path, content, mimetypes.guess_type(path)[0] or "application/octet-stream")
        if existing is not None:
            await db.delete(existing)
            await db.flush()
        db.add(skill)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        await _drop_prefix(prefix)
        raise ApiError(409, "skill_exists", f"A skill named {parsed.name!r} already exists") from None
    except Exception:
        await db.rollback()
        await _drop_prefix(prefix)
        raise
    if old_prefix:
        await _drop_prefix(old_prefix)
    return {"skill": skill_json(skill)}


@router.get("/{skill_id}")
async def get_skill(skill_id: uuid.UUID, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)):
    s = await _owned(db, user, skill_id)
    md = await storage.get_bytes(_prefix(user.id, s.id) + "SKILL.md")
    return {"skill": skill_json(s), "files": s.files, "skill_md": md.decode("utf-8", "replace")}


@router.patch("/{skill_id}")
async def patch_skill(
    skill_id: uuid.UUID, body: PatchSkill, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)
):
    s = await _owned(db, user, skill_id)
    s.enabled = body.enabled
    s.updated_at = datetime.now(UTC)
    await db.commit()
    return {"skill": skill_json(s)}


@router.delete("/{skill_id}", status_code=204)
async def delete_skill(
    skill_id: uuid.UUID, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)
) -> Response:
    s = await _owned(db, user, skill_id)
    prefix = _prefix(user.id, s.id)
    await db.delete(s)
    await db.commit()
    await _drop_prefix(prefix)  # after the DB commit: a failure only leaves orphan objects, never a broken skill
    return Response(status_code=204)

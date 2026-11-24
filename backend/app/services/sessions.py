import uuid
from datetime import UTC, datetime, timedelta

from fastapi import Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Session, User
from app.security import new_session_token, token_digest


def cookie_name() -> str:
    """`__Host-` prefix when Secure is on: the browser then requires Secure, Path=/ and no Domain."""
    return "__Host-ec_session" if get_settings().cookie_secure_on else "ec_session"


def _now() -> datetime:
    return datetime.now(UTC)


def set_session_cookie(response: Response, token: str, max_age: int | None = None) -> None:
    s = get_settings()
    response.set_cookie(
        cookie_name(),
        token,
        max_age=max_age if max_age is not None else s.session_idle_days * 86400,
        httponly=True,
        samesite="lax",
        secure=s.cookie_secure_on,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(cookie_name(), path="/", httponly=True, samesite="lax", secure=s.cookie_secure_on)


async def create_session(db: AsyncSession, user: User, ip: str | None, user_agent: str | None) -> str:
    s = get_settings()
    now = _now()
    token = new_session_token()
    absolute = now + timedelta(days=s.session_absolute_days)
    db.add(
        Session(
            user_id=user.id,
            token_hash=token_digest(token),
            created_at=now,
            last_seen_at=now,
            expires_at=min(now + timedelta(days=s.session_idle_days), absolute),
            absolute_expires_at=absolute,
            ip=ip,
            user_agent=(user_agent or "")[:255] or None,
        )
    )
    return token


async def resolve_session(db: AsyncSession, token: str) -> tuple[Session, User, bool] | None:
    """Return (session, user, refreshed) for a live token; delete and return None if expired."""
    row = (
        await db.execute(
            select(Session, User).join(User, User.id == Session.user_id).where(Session.token_hash == token_digest(token))
        )
    ).first()
    if row is None:
        return None
    session, user = row
    s = get_settings()
    now = _now()
    if now >= session.expires_at or now >= session.absolute_expires_at:
        await db.delete(session)
        await db.commit()
        return None
    refreshed = False
    if (now - session.last_seen_at).total_seconds() >= s.session_refresh_seconds:
        session.last_seen_at = now
        session.expires_at = min(now + timedelta(days=s.session_idle_days), session.absolute_expires_at)
        await db.commit()
        refreshed = True
    return session, user, refreshed


async def revoke_user_sessions(db: AsyncSession, user_id: uuid.UUID, keep: uuid.UUID | None = None) -> None:
    stmt = delete(Session).where(Session.user_id == user_id)
    if keep is not None:
        stmt = stmt.where(Session.id != keep)
    await db.execute(stmt)

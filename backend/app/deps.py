from fastapi import Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.models import Session, User
from app.security import client_ip
from app.services.sessions import COOKIE_NAME, resolve_session, set_session_cookie

__all__ = ["get_db", "current_session", "current_user", "active_user", "admin_user", "client_ip"]


async def current_session(
    request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> tuple[Session, User]:
    token = request.cookies.get(COOKIE_NAME)
    resolved = await resolve_session(db, token) if token else None
    if resolved is None:
        raise ApiError(401, "unauthenticated", "Not signed in")
    session, user, refreshed = resolved
    if user.status == "disabled":
        raise ApiError(403, "account_disabled", "This account is disabled")
    if refreshed:
        set_session_cookie(response, token, get_settings().session_idle_days * 86400)
    return session, user


async def current_user(auth: tuple[Session, User] = Depends(current_session)) -> User:
    return auth[1]


async def active_user(user: User = Depends(current_user)) -> User:
    if user.status != "active":
        raise ApiError(403, "account_pending", "Your account is waiting for admin approval")
    return user


async def admin_user(user: User = Depends(active_user)) -> User:
    if user.role != "admin":
        raise ApiError(403, "forbidden", "Admin only")
    return user

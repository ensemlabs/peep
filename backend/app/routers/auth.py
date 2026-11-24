import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.deps import current_session, current_user, get_db
from app.errors import ApiError
from app.models import Session, User
from app.schemas import ChangePasswordBody, LoginBody, RegisterBody, iso, user_json
from app.security import (
    PASSWORD_MAX,
    client_ip,
    email_is_valid,
    hash_password,
    needs_rehash,
    normalize_email,
    password_problem,
    token_digest,
    verify_dummy,
    verify_password,
)
from app.services import throttle
from app.services.quota import period_bounds, used_tokens
from app.services.sessions import COOKIE_NAME, clear_session_cookie, create_session, revoke_user_sessions, set_session_cookie

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


def validate_new_password(password: str, email: str) -> None:
    problem = password_problem(password, email)
    if problem:
        raise ApiError(422, "weak_password", problem)


@router.post("/register", status_code=201)
async def register(body: RegisterBody, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    s = get_settings()
    ip = client_ip(request)
    await throttle.hit_counter(db, f"reg:{ip}", s.reg_max, s.reg_window_seconds)

    email = normalize_email(body.email)
    if not email_is_valid(email):
        raise ApiError(422, "invalid_email", "Invalid email address")
    display_name = body.display_name.strip()
    if not 1 <= len(display_name) <= 80:
        raise ApiError(422, "invalid_display_name", "Display name must be 1-80 characters")
    validate_new_password(body.password, email)

    exists = (await db.execute(select(User.id).where(func.lower(User.email) == email))).first()
    if exists:
        raise ApiError(409, "email_taken", "This email is already registered")

    user = User(
        email=email,
        display_name=display_name,
        password_hash=await hash_password(body.password),
        last_login_at=datetime.now(UTC),
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ApiError(409, "email_taken", "This email is already registered") from None
    token = await create_session(db, user, ip, request.headers.get("user-agent"))
    await db.commit()
    set_session_cookie(response, token)
    return {"user": user_json(user)}


@router.post("/login")
async def login(body: LoginBody, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    s = get_settings()
    ip = client_ip(request)
    email = normalize_email(body.email)
    acct_key = f"acct:{email}|{ip}"

    await throttle.hit_counter(db, f"ip:{ip}", s.ip_login_max, s.throttle_window_seconds)
    await throttle.check_not_locked(db, acct_key)

    user = (await db.execute(select(User).where(func.lower(User.email) == email))).scalar_one_or_none()
    if len(body.password) > 1024:
        ok = False  # do not hash megabytes of input
    elif user is None:
        await verify_dummy(body.password)
        ok = False
    else:
        ok = await verify_password(user.password_hash, body.password)
    if not ok or user is None:
        await throttle.record_failure(db, acct_key)
        raise ApiError(401, "invalid_credentials", "Invalid email or password")

    await throttle.reset(db, acct_key)
    if user.status == "disabled":
        raise ApiError(403, "account_disabled", "This account is disabled")

    if needs_rehash(user.password_hash):
        user.password_hash = await hash_password(body.password)
    user.last_login_at = datetime.now(UTC)
    token = await create_session(db, user, ip, request.headers.get("user-agent"))
    await db.commit()
    set_session_cookie(response, token)
    return {"user": user_json(user)}


@router.post("/logout", status_code=204)
async def logout(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        await db.execute(delete(Session).where(Session.token_hash == token_digest(token)))
        await db.commit()
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


@router.get("/me")
async def me(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    _, resets_at = period_bounds(user.token_period)
    return {
        "user": user_json(user),
        "quota": {
            "limit": user.token_limit,
            "period": user.token_period,
            "used": await used_tokens(db, user.id, user.token_period),
            "resets_at": iso(resets_at),
        },
    }


@router.post("/password", status_code=204)
async def change_password(
    body: ChangePasswordBody,
    auth: tuple[Session, User] = Depends(current_session),
    db: AsyncSession = Depends(get_db),
) -> Response:
    session, user = auth
    key = f"pw:{user.id}"
    await throttle.check_not_locked(db, key)
    if len(body.current_password) > PASSWORD_MAX * 8 or not await verify_password(
        user.password_hash, body.current_password
    ):
        await throttle.record_failure(db, key)
        raise ApiError(400, "invalid_current_password", "Current password is incorrect")
    await throttle.reset(db, key)
    validate_new_password(body.new_password, user.email)
    user.password_hash = await hash_password(body.new_password)
    await revoke_user_sessions(db, user.id, keep=session.id)
    await db.commit()
    return Response(status_code=204)

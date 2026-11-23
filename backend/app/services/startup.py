import asyncio
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import func, select, update

from app.config import get_settings
from app.db import get_sessionmaker
from app.models import Message, User
from app.security import hash_password, normalize_email

log = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _upgrade() -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(cfg, "head")


async def run_migrations() -> None:
    # In a thread: alembic's async env calls asyncio.run(), which needs a thread without a running loop.
    await asyncio.to_thread(_upgrade)


async def seed_admin() -> None:
    s = get_settings()
    email = normalize_email(s.admin_email)
    if not email or not s.admin_password:
        return
    async with get_sessionmaker()() as db:
        user = (await db.execute(select(User).where(func.lower(User.email) == email))).scalar_one_or_none()
        if user is None:
            db.add(
                User(
                    email=email,
                    display_name="Admin",
                    password_hash=await hash_password(s.admin_password),
                    role="admin",
                    status="active",
                )
            )
            log.info("seeded admin user %s", email)
        elif user.role != "admin" or user.status != "active":
            user.role = "admin"
            user.status = "active"
            log.info("promoted existing user %s to active admin", email)
        await db.commit()


async def mark_interrupted_messages() -> None:
    async with get_sessionmaker()() as db:
        result = await db.execute(
            update(Message).where(Message.status == "streaming").values(status="error", error="interrupted")
        )
        await db.commit()
        if result.rowcount:
            log.warning("marked %d streaming messages as interrupted", result.rowcount)


async def check_secrets() -> None:
    """Startup check of plugin secret storage.

    Fails only when the stored data cannot be read: encrypted header values exist and SECRETS_KEY is missing,
    invalid, or does not decrypt them. Header-less plugins need no key, so they never block startup.
    """
    from sqlalchemy import func, text

    from app.models import Plugin
    from app.services import secrets

    key_set = bool(get_settings().secrets_key.strip())
    async with get_sessionmaker()() as db:
        encrypted = (
            await db.execute(select(func.count()).select_from(Plugin).where(text("jsonb_array_length(headers) > 0")))
        ).scalar_one()
        sample = None
        if encrypted:
            row = (await db.execute(select(Plugin.headers).where(text("jsonb_array_length(headers) > 0")).limit(1))).first()
            sample = row[0][0]["value_enc"] if row else None

    key_problem = None
    try:
        secrets.validate_key_configured()
    except secrets.SecretsNotConfigured as e:
        key_problem = str(e)

    if encrypted:
        if key_problem:
            raise RuntimeError(f"{encrypted} plugin(s) hold encrypted header values but {key_problem}")
        if sample is not None and not secrets.check_token(sample):
            raise RuntimeError(
                "SECRETS_KEY cannot decrypt the stored plugin header values (wrong key?). "
                "Restore the key that was used when the plugins were saved."
            )
    elif key_problem:
        reason = "SECRETS_KEY is not set" if not key_set else "SECRETS_KEY is not a valid Fernet key"
        log.warning("%s: saving plugin headers is disabled until it is configured", reason)

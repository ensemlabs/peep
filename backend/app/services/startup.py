import asyncio
import logging
import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import func, select, update

from app.config import get_settings
from app.db import get_sessionmaker
from app.models import AdminAudit, Message, User
from app.security import hash_password, normalize_email, verify_password

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
        elif user.role == "admin" and user.status == "active":
            return  # nothing to do, and no reason to check the password
        elif not await verify_password(user.password_hash, s.admin_password):
            # Anyone can register ADMIN_EMAIL before the first start: never hand them the admin role.
            log.error("an account for %s exists and ADMIN_PASSWORD does not match it: left untouched", email)
        else:
            # The operator proves ownership with the password (recovery path for a demoted or disabled admin).
            # Same audit actions as the admin UI, so the entries render and filter there.
            for action, field, new in (("user.role", "role", "admin"), ("user.status", "status", "active")):
                old = getattr(user, field)
                if old != new:
                    db.add(
                        AdminAudit(
                            actor_id=None,
                            actor_email="system",
                            target_id=user.id,
                            target_email=user.email,
                            action=action,
                            detail={"from": old, "to": new, "via": "seed"},
                        )
                    )
                    setattr(user, field, new)
            log.info("promoted existing user %s to active admin", email)
        await db.commit()


DEFAULT_SECRET_VARS = ("ADMIN_PASSWORD", "POSTGRES_PASSWORD", "MINIO_ROOT_PASSWORD", "S3_SECRET_KEY")


def check_default_credentials() -> None:
    """In production, refuse to start with the placeholder values from .env.example (names only in the message)."""
    if get_settings().app_env != "production":
        return
    bad = [n for n in DEFAULT_SECRET_VARS if "change-me" in os.environ.get(n, "")]
    if bad:
        raise RuntimeError(
            "Refusing to start: these variables still hold the example placeholder 'change-me': "
            + ", ".join(bad)
            + ". Set real secrets in .env (make env generates them for a new .env)."
        )


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
    elif key_problem and key_set:
        raise RuntimeError("SECRETS_KEY is set but is not a valid Fernet key (32 url-safe base64-encoded bytes)")
    elif key_problem:
        log.warning("SECRETS_KEY is not set: saving plugin headers is disabled until it is configured")

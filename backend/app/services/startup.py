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

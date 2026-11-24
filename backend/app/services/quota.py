"""Token quota: reset windows (UTC), usage ledger and the admin audit log."""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AdminAudit, TokenUsage, User


def period_bounds(period: str, now: datetime | None = None) -> tuple[datetime, datetime]:
    """(start of the current window, start of the next one) in UTC; `day` or `month`."""
    now = (now or datetime.now(UTC)).astimezone(UTC)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "day":
        return start, start + timedelta(days=1)
    start = start.replace(day=1)
    nxt = (start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1))
    return start, nxt


async def used_tokens(db: AsyncSession, user_id: uuid.UUID, period: str, now: datetime | None = None) -> int:
    start, _ = period_bounds(period, now)
    q = select(func.coalesce(func.sum(TokenUsage.tokens), 0)).where(
        TokenUsage.user_id == user_id, TokenUsage.created_at >= start
    )
    return int((await db.execute(q)).scalar_one())


async def used_tokens_many(db: AsyncSession, users: Sequence[User], now: datetime | None = None) -> dict[uuid.UUID, int]:
    """Tokens used in each user's own current window, in one grouped query."""
    if not users:
        return {}
    day, month = period_bounds("day", now)[0], period_bounds("month", now)[0]
    since = case((User.token_period == "day", day), else_=month)
    q = (
        select(TokenUsage.user_id, func.sum(TokenUsage.tokens))
        .join(User, User.id == TokenUsage.user_id)
        .where(TokenUsage.user_id.in_([u.id for u in users]), TokenUsage.created_at >= since)
        .group_by(TokenUsage.user_id)
    )
    used = {uid: int(total) for uid, total in (await db.execute(q)).all()}
    return {u.id: used.get(u.id, 0) for u in users}


def record_usage(db: AsyncSession, user_id: uuid.UUID, message_id: uuid.UUID, tokens: int) -> None:
    """Add a ledger row to the caller's transaction."""
    db.add(TokenUsage(user_id=user_id, message_id=message_id, tokens=tokens))


def log_admin(db: AsyncSession, actor: User, target: User | None, action: str, detail: dict[str, Any] | None = None) -> None:
    """Add an audit row to the caller's transaction (emails are snapshots; they survive deletion)."""
    db.add(
        AdminAudit(
            actor_id=actor.id,
            actor_email=actor.email,
            target_id=target.id if target else None,
            target_email=target.email if target else None,
            action=action,
            detail=detail or {},
        )
    )

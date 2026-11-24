"""Postgres-backed throttling (table auth_throttle), one atomic statement per update."""

import math
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.errors import ApiError


def too_many(retry_after_s: float) -> ApiError:
    secs = max(1, math.ceil(retry_after_s))
    return ApiError(
        429,
        "too_many_attempts",
        "Too many attempts, try again later",
        headers={"Retry-After": str(secs)},
    )


def _now() -> datetime:
    return datetime.now(UTC)


_HIT = text(
    """
    INSERT INTO auth_throttle AS t (key, fail_count, window_start, lock_level, updated_at)
    VALUES (:key, 1, :now, 0, :now)
    ON CONFLICT (key) DO UPDATE SET
      fail_count = CASE WHEN t.window_start <= :cutoff THEN 1 ELSE t.fail_count + 1 END,
      window_start = CASE WHEN t.window_start <= :cutoff THEN :now ELSE t.window_start END,
      updated_at = :now
    RETURNING fail_count, window_start
    """
)

_LOCK = text(
    """
    UPDATE auth_throttle SET
      locked_until = CAST(:now AS timestamptz)
        + make_interval(secs => LEAST(CAST(:base AS double precision) * power(2, lock_level), CAST(:cap AS double precision))),
      lock_level = lock_level + 1,
      fail_count = 0
    WHERE key = :key AND fail_count >= :max
    """
)


async def hit_counter(db: AsyncSession, key: str, limit: int, window_s: int) -> None:
    """Count one event for `key`; raise 429 when more than `limit` happened in the window."""
    now = _now()
    row = (
        await db.execute(_HIT, {"key": key, "now": now, "cutoff": now - timedelta(seconds=window_s)})
    ).one()
    await db.commit()
    if row.fail_count > limit:
        raise too_many((row.window_start + timedelta(seconds=window_s) - now).total_seconds())


async def check_budget(db: AsyncSession, key: str, limit: int, window_s: int) -> None:
    """Raise 429 once `limit` events were already counted for `key` in the window (does not count anything)."""
    now = _now()
    row = (await db.execute(text("SELECT fail_count, window_start FROM auth_throttle WHERE key = :key"), {"key": key})).first()
    await db.commit()
    if row and row.window_start > now - timedelta(seconds=window_s) and row.fail_count >= limit:
        raise too_many((row.window_start + timedelta(seconds=window_s) - now).total_seconds())


async def count_failure(db: AsyncSession, key: str) -> None:
    """Count one failed attempt for `key` (no lock); enforced by check_budget."""
    now = _now()
    cutoff = now - timedelta(seconds=get_settings().throttle_window_seconds)
    await db.execute(_HIT, {"key": key, "now": now, "cutoff": cutoff})
    await db.commit()


async def check_not_locked(db: AsyncSession, key: str) -> None:
    now = _now()
    locked_until = (
        await db.execute(text("SELECT locked_until FROM auth_throttle WHERE key = :key"), {"key": key})
    ).scalar()
    await db.commit()  # end the read transaction (commit, not rollback: rollback would expire loaded objects)
    if locked_until is not None and locked_until > now:
        raise too_many((locked_until - now).total_seconds())


async def record_failure(db: AsyncSession, key: str) -> None:
    s = get_settings()
    now = _now()
    await db.execute(_HIT, {"key": key, "now": now, "cutoff": now - timedelta(seconds=s.throttle_window_seconds)})
    await db.execute(
        _LOCK,
        {"key": key, "now": now, "max": s.login_max_failures, "base": s.lock_base_seconds, "cap": s.lock_max_seconds},
    )
    await db.commit()


async def reset(db: AsyncSession, key: str) -> None:
    await db.execute(text("DELETE FROM auth_throttle WHERE key = :key"), {"key": key})
    await db.commit()

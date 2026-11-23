import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import active_user
from app.models import File, User
from app.routers.conversations import choose_model, owned_conversation
from app.services import history, tokens
from app.services.history import Turns

router = APIRouter(prefix="/api", tags=["context"])

KEYS = ("system", "user_messages", "assistant_messages", "attachments", "tool_results", "skills")
DRAFT_UPLOAD_WINDOW = timedelta(hours=24)


def _context_numbers(turns: Turns, image_tokens: int, ratio: float) -> dict[str, dict]:
    out = {k: {"key": k, "tokens": 0} for k in KEYS}
    for role, text in turns.previous:
        out["user_messages" if role == "user" else "assistant_messages"]["tokens"] += tokens.count_text(text, ratio)
    out["user_messages"]["tokens"] += tokens.count_text(turns.last_text, ratio)
    items = []
    for f in turns.images:
        items.append({"name": f.filename, "tokens": image_tokens})
    for line in turns.lines:
        items.append({"name": line, "tokens": tokens.count_text(line, ratio)})
    if items:
        out["attachments"]["items"] = items
        out["attachments"]["tokens"] = sum(i["tokens"] for i in items)
    return out


@router.get("/context")
async def get_context(
    conversation_id: uuid.UUID | None = None,
    user: User = Depends(active_user),
    db: AsyncSession = Depends(get_db),
):
    """Token breakdown of what the next request in this conversation would send (tiktoken estimate)."""
    conv = await owned_conversation(db, user, conversation_id) if conversation_id else None
    model = choose_model(None, conv)

    # uploads not yet attached to a message: the draft the user is composing
    conv_cond = File.conversation_id.is_(None) if conv is None else File.conversation_id == conv.id
    drafts = (
        await db.execute(
            select(File)
            .where(
                File.user_id == user.id,
                File.message_id.is_(None),
                File.source == "upload",
                conv_cond,
                File.created_at > datetime.now(UTC) - DRAFT_UPLOAD_WINDOW,
            )
            .order_by(File.created_at)
        )
    ).scalars().all()

    rows = await history.fetch_rows(db, conv.id) if conv else []
    turns = await history.load_turns(db, conv.id, None, list(drafts), rows=rows) if conv else Turns()
    if conv is None:
        turns.images, turns.lines = history.split_attachments(list(drafts))

    ratio = model.cfg.token_ratio
    # tokenising a long history is CPU work: keep it off the event loop
    numbers = await asyncio.to_thread(_context_numbers, turns, model.cfg.image_tokens, ratio)
    used = sum(v["tokens"] for v in numbers.values())

    last_usage = None
    totals: dict[str, int | None] = {
        "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": None, "cache_write_tokens": None, "messages": 0,
    }
    for m in rows:
        if m.role == "assistant" and m.usage:
            last_usage = m.usage
            totals["messages"] += 1
            for k in ("input_tokens", "output_tokens"):
                totals[k] += m.usage.get(k) or 0
            for k in ("cache_read_tokens", "cache_write_tokens"):  # null until some message reports the field
                if m.usage.get(k) is not None:
                    totals[k] = (totals[k] or 0) + m.usage[k]

    estimated = True
    final_usage = rows[-1].usage if rows and rows[-1].role == "assistant" else None
    if final_usage and final_usage.get("source") == "provider" and not drafts:
        # the provider's real count right after the last reply (reasoning tokens are not resent)
        used = (final_usage.get("input_tokens") or 0) + (final_usage.get("output_tokens") or 0) - (final_usage.get("reasoning_tokens") or 0)
        estimated = False

    return {
        "model_id": model.id,
        "context_window": model.cfg.context_window,
        "used_tokens": used,
        "free_tokens": max(0, model.cfg.context_window - used),
        "estimated": estimated,
        "breakdown": [numbers[k] for k in KEYS],
        "last_usage": last_usage,
        "totals": totals,
    }

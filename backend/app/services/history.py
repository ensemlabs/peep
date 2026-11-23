"""Build the OpenAI chat history for a run: text of earlier turns, plus attachments of the last user turn."""

import base64
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import File, Message
from app.services import storage

MAX_IMAGES = 16
MAX_IMAGE_BYTES = 20 * 1024 * 1024


def _human_size(n: int) -> str:
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{int(size)} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{n} B"


def attachment_line(f: File) -> str:
    return f"[Attached file: {f.filename} ({f.mime}, {_human_size(f.size)})]"


async def build_openai_messages(
    db: AsyncSession, conversation_id: uuid.UUID, user_message_id: uuid.UUID
) -> list[dict[str, Any]]:
    """Messages up to and including `user_message_id`. Thinking and tool parts are not replayed."""
    rows = (
        await db.execute(
            select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at, Message.role.desc())
        )
    ).scalars().all()
    history: list[Message] = []
    for m in rows:
        history.append(m)
        if m.id == user_message_id:
            break

    out: list[dict[str, Any]] = []
    for m in history[:-1]:
        if m.content.strip():
            out.append({"role": m.role, "content": m.content})

    last = history[-1]
    files = (
        await db.execute(select(File).where(File.message_id == last.id, File.source == "upload").order_by(File.created_at))
    ).scalars().all()
    lines: list[str] = []
    images: list[dict[str, Any]] = []
    for f in files:
        if f.kind == "image" and len(images) < MAX_IMAGES and f.size <= MAX_IMAGE_BYTES:
            data = await storage.get_bytes(f.object_key)
            b64 = base64.b64encode(data).decode()
            images.append({"type": "image_url", "image_url": {"url": f"data:{f.mime};base64,{b64}"}})
        else:
            lines.append(attachment_line(f))
    text = "\n".join(filter(None, [last.content, *lines]))
    if images:
        out.append({"role": "user", "content": [{"type": "text", "text": text or "(image)"}, *images]})
    else:
        out.append({"role": "user", "content": text})
    return out

"""Build the OpenAI chat history for a run: text of earlier turns, plus attachments of the last user turn.

`load_turns` is the single source of truth: the run builder turns it into messages, and /api/context
counts tokens over the very same turns.
"""

import base64
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import File, Message
from app.services import storage

MAX_IMAGES = 16
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024  # raw bytes of all images sent in one request


def _human_size(n: int) -> str:
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{int(size)} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{n} B"


def attachment_line(f: File) -> str:
    return f"[Attached file: {f.filename} ({f.mime}, {_human_size(f.size)})]"


@dataclass
class Turns:
    previous: list[tuple[str, str]] = field(default_factory=list)  # (role, text) of earlier turns
    last_text: str = ""  # text of the last user turn
    images: list[File] = field(default_factory=list)  # attachments sent as image_url
    lines: list[str] = field(default_factory=list)  # other attachments, sent as text lines


def split_attachments(files: list[File]) -> tuple[list[File], list[str]]:
    images: list[File] = []
    lines: list[str] = []
    total = 0
    for f in files:
        if f.kind == "image" and len(images) < MAX_IMAGES and f.size <= MAX_IMAGE_BYTES and total + f.size <= MAX_TOTAL_IMAGE_BYTES:
            images.append(f)
            total += f.size
        else:
            lines.append(attachment_line(f))
    return images, lines


async def fetch_rows(db: AsyncSession, conversation_id: uuid.UUID) -> list[Any]:
    """Only the columns history needs (no parts JSON), in conversation order."""
    return list(
        (
            await db.execute(
                select(Message.id, Message.role, Message.content, Message.usage)
                .where(Message.conversation_id == conversation_id)
                .order_by(Message.created_at, Message.role.desc())
            )
        ).all()
    )


async def load_turns(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    user_message_id: uuid.UUID | None = None,
    draft_files: list[File] | None = None,
    rows: list[Any] | None = None,
) -> Turns:
    """Turns for answering `user_message_id`; or, when it is None, for the *next* user message.

    In the next-message case every stored message is a previous turn and the draft is `draft_files`
    (uploads not yet attached to a message). Pass `rows` (from `fetch_rows`) to avoid a second query.
    """
    rows = rows if rows is not None else await fetch_rows(db, conversation_id)
    history: list[Any] = []
    for m in rows:
        history.append(m)
        if user_message_id is not None and m.id == user_message_id:
            break
    turns = Turns()
    if user_message_id is None:
        turns.previous = [(m.role, m.content) for m in history if m.content.strip()]
        turns.images, turns.lines = split_attachments(draft_files or [])
        return turns
    turns.previous = [(m.role, m.content) for m in history[:-1] if m.content.strip()]
    last = history[-1]
    files = (
        await db.execute(select(File).where(File.message_id == last.id, File.source == "upload").order_by(File.created_at))
    ).scalars().all()
    turns.last_text = last.content
    turns.images, turns.lines = split_attachments(list(files))
    return turns


async def build_openai_messages(
    db: AsyncSession, conversation_id: uuid.UUID, user_message_id: uuid.UUID
) -> list[dict[str, Any]]:
    """Messages up to and including `user_message_id`. Thinking and tool parts are not replayed."""
    turns = await load_turns(db, conversation_id, user_message_id)
    out: list[dict[str, Any]] = [{"role": r, "content": c} for r, c in turns.previous]
    text = "\n".join(filter(None, [turns.last_text, *turns.lines]))
    if turns.images:
        images = []
        for f in turns.images:
            data = await storage.get_bytes(f.object_key)
            b64 = base64.b64encode(data).decode()
            images.append({"type": "image_url", "image_url": {"url": f"data:{f.mime};base64,{b64}"}})
        out.append({"role": "user", "content": [{"type": "text", "text": text or "(image)"}, *images]})
    else:
        out.append({"role": "user", "content": text})
    return out

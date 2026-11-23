import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.deps import active_user
from app.errors import ApiError
from app.models import Conversation, File, Message, User
from app.providers.base import RunContext
from app.providers.openai_provider import OpenAIProvider
from app.providers.replay_provider import ReplayProvider
from app.schemas import iso
from app.services import llm_models, media
from app.services.runs import sse_response, RunState, ev, message_json, registry, stream_events

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

MAX_CONTENT_CHARS = 100_000
TITLE_CHARS = 60


class _Body(BaseModel):
    model_config = ConfigDict(extra="ignore")


class CreateConversation(_Body):
    title: str | None = Field(None, max_length=200)
    model: str | None = None


class PatchConversation(_Body):
    title: str = Field(max_length=200)


class SendMessage(_Body):
    content: str = Field("", max_length=MAX_CONTENT_CHARS)
    attachment_ids: list[uuid.UUID] = Field(default_factory=list, max_length=32)
    model: str | None = None
    reasoning: Literal["off", "high"] = "off"


def conversation_json(c: Conversation) -> dict:
    return {
        "id": str(c.id),
        "title": c.title,
        "model": c.model,
        "created_at": iso(c.created_at),
        "updated_at": iso(c.updated_at),
    }


async def owned_conversation(db: AsyncSession, user: User, conversation_id: uuid.UUID) -> Conversation:
    conv = await db.get(Conversation, conversation_id)
    if conv is None or conv.user_id != user.id:
        raise ApiError(404, "not_found", "Conversation not found")
    return conv


async def attachments_by_message(db: AsyncSession, messages: list[Message]) -> dict[uuid.UUID, list[dict]]:
    ids = [m.id for m in messages if m.role == "user"]
    result: dict[uuid.UUID, list[dict]] = {}
    if ids:
        files = (
            await db.execute(
                select(File).where(File.message_id.in_(ids), File.source == "upload").order_by(File.created_at, File.id)
            )
        ).scalars()
        for f in files:
            result.setdefault(f.message_id, []).append(media.file_meta(f))  # type: ignore[arg-type]
    return result


async def validate_model(model: str) -> str:
    available = {m["id"] for m in (await llm_models.list_models())["items"]}
    if model not in available:
        raise ApiError(422, "invalid_model", f"Unknown model {model!r}")
    return model


@router.get("")
async def list_conversations(
    limit: int = Query(50, ge=1, le=100),
    before: datetime | None = None,
    user: User = Depends(active_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(Conversation).where(Conversation.user_id == user.id)
    if before is not None:
        if before.tzinfo is None:
            before = before.replace(tzinfo=UTC)
        q = q.where(Conversation.updated_at < before)
    rows = (await db.execute(q.order_by(Conversation.updated_at.desc(), Conversation.id).limit(limit))).scalars()
    return {
        "items": [
            {"id": str(c.id), "title": c.title, "model": c.model, "updated_at": iso(c.updated_at)} for c in rows
        ]
    }


@router.post("", status_code=201)
async def create_conversation(
    body: CreateConversation, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)
):
    model = await validate_model(body.model) if body.model else (await llm_models.list_models())["default"]
    conv = Conversation(user_id=user.id, title=(body.title or "").strip(), model=model)
    db.add(conv)
    await db.commit()
    return {"conversation": conversation_json(conv)}


@router.get("/{conversation_id}")
async def get_conversation(
    conversation_id: uuid.UUID, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)
):
    conv = await owned_conversation(db, user, conversation_id)
    messages = list(
        (
            await db.execute(
                select(Message)
                .where(Message.conversation_id == conv.id)
                .order_by(Message.created_at, Message.role.desc(), Message.id)
            )
        ).scalars()
    )
    atts = await attachments_by_message(db, messages)
    return {
        "conversation": conversation_json(conv),
        "messages": [message_json(m, atts.get(m.id, [])) for m in messages],
    }


@router.patch("/{conversation_id}")
async def rename_conversation(
    conversation_id: uuid.UUID,
    body: PatchConversation,
    user: User = Depends(active_user),
    db: AsyncSession = Depends(get_db),
):
    conv = await owned_conversation(db, user, conversation_id)
    title = body.title.strip()
    if not title:
        raise ApiError(422, "invalid_request", "title must not be empty")
    conv.title = title
    await db.commit()
    return {"conversation": conversation_json(conv)}


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: uuid.UUID, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)
) -> Response:
    conv = await owned_conversation(db, user, conversation_id)
    if registry.is_busy(conv.id):
        raise ApiError(409, "run_in_progress", "Stop the running reply before deleting this conversation")
    await media.delete_conversation_files(db, conv.id)
    await db.delete(conv)
    await db.commit()
    return Response(status_code=204)


def _make_title(content: str, attachments: list[File]) -> str:
    title = re.sub(r"\s+", " ", content).strip()
    if not title and attachments:
        title = attachments[0].filename
    return title[:TITLE_CHARS]


@router.post("/{conversation_id}/messages")
async def send_message(
    conversation_id: uuid.UUID,
    body: SendMessage,
    user: User = Depends(active_user),
    db: AsyncSession = Depends(get_db),
):
    conv = await owned_conversation(db, user, conversation_id)
    if not body.content.strip() and not body.attachment_ids:
        raise ApiError(422, "empty_message", "Message needs text or an attachment")
    model = await validate_model(body.model or conv.model or get_settings().llm_default_model)
    if body.reasoning == "high" and model.startswith("replay:"):
        body.reasoning = "off"

    if not registry.reserve(conv.id):
        raise ApiError(409, "run_in_progress", "A reply is already being generated in this conversation")
    try:
        unique_ids = list(dict.fromkeys(body.attachment_ids))
        files: list[File] = []
        if unique_ids:
            by_id = {
                f.id: f
                for f in (
                    await db.execute(select(File).where(File.id.in_(unique_ids), File.user_id == user.id))
                ).scalars()
            }
            for fid in unique_ids:
                f = by_id.get(fid)
                if f is None or f.message_id is not None or f.conversation_id not in (None, conv.id):
                    raise ApiError(422, "invalid_attachment", f"Attachment {fid} is not available")
                files.append(f)

        now = datetime.now(UTC)
        user_msg = Message(
            conversation_id=conv.id, role="user", content=body.content, status="complete", created_at=now, updated_at=now
        )
        asst = Message(
            conversation_id=conv.id,
            role="assistant",
            status="streaming",
            model=model,
            created_at=now + timedelta(milliseconds=1),
            updated_at=now + timedelta(milliseconds=1),
        )
        db.add_all([user_msg, asst])
        await db.flush()
        for f in files:
            f.conversation_id = conv.id
            f.message_id = user_msg.id
        if not conv.title:
            conv.title = _make_title(body.content, files)
        conv.model = model
        conv.updated_at = now
        await db.commit()
    except BaseException:
        registry.release(conv.id)
        raise

    state = RunState(asst, conv.id, user.id)
    provider = ReplayProvider() if model.startswith("replay:") else OpenAIProvider()
    ctx = RunContext(
        state,
        user_id=user.id,
        conversation_id=conv.id,
        user_message_id=user_msg.id,
        model=model,
        reasoning=body.reasoning == "high",
    )
    q = state.subscribe()
    registry.start(state, provider, ctx)
    first = ev(
        "message",
        {
            "user_message": message_json(user_msg, [media.file_meta(f) for f in files]),
            "assistant_message": message_json(asst, []),
        },
    )
    return sse_response(stream_events(state, q, [first]))

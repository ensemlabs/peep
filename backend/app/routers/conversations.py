import re
import uuid
from datetime import UTC, datetime, timedelta
from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, exists, func, literal, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import active_user
from app.errors import ApiError
from app.models import Conversation, File, Message, User
from app.providers.base import RunContext
from app.providers.openai_provider import OpenAIProvider
from app.providers.replay_provider import ReplayProvider
from app.schemas import iso
from app.services import media
from app.services import model_registry as mr
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
    title: str | None = Field(None, max_length=200)
    pinned: bool | None = None


class SendMessage(_Body):
    content: str = Field("", max_length=MAX_CONTENT_CHARS)
    attachment_ids: list[uuid.UUID] = Field(default_factory=list, max_length=32)
    model: str | None = None
    reasoning: str | None = Field(None, max_length=32)  # thinking level id; None = model default


def conversation_json(c: Conversation) -> dict:
    return {
        "id": str(c.id),
        "title": c.title,
        "model": c.model,
        "created_at": iso(c.created_at),
        "updated_at": iso(c.updated_at),
        "pinned": c.pinned,
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


def choose_model(requested: str | None, conv: Conversation | None = None) -> mr.ResolvedModel:
    """The model for a request. Outside dev.model_switcher the configured active model always wins."""
    reg = mr.get_registry()
    sel = mr.selectable(reg)
    if reg.switchable:
        wanted = requested or (conv.model if conv and conv.model in sel else None) or reg.active_id
        if wanted not in sel:
            raise ApiError(422, "invalid_model", f"Unknown model {wanted!r}")
        return sel[wanted]
    return sel[reg.active_id]


def choose_level(model: mr.ResolvedModel, requested: str | None) -> str | None:
    t = model.cfg.thinking
    if t is None:
        return None  # model has no thinking levels: the field is ignored
    if requested is None:
        return t.default
    if requested not in {lv.id for lv in t.levels}:
        raise ApiError(422, "invalid_reasoning_level", f"Model {model.id!r} has no thinking level {requested!r}")
    return requested


_MD_STRIP = [
    (re.compile(r"```[^\n]*\n?"), " "),
    (re.compile(r"!\[[^\]]*\]\([^)]*\)"), " "),
    (re.compile(r"\[([^\]]*)\]\([^)]*\)"), r"\1"),
    (re.compile(r"(?m)^\s{0,3}(#{1,6}|>+|[-*+]|\d+\.)\s+"), ""),
    (re.compile(r"[`*_~|]+"), ""),
    (re.compile(r"\s+"), " "),
]


PREVIEW_INPUT_CAP = 400  # work on a bounded prefix: keeps every regex cheap whatever the message holds


def _is_separator_line(line: str) -> bool:
    """Markdown table separator or horizontal rule (|---|:--:|, ---): only | : - and spaces, with a dash run."""
    s = line.strip()
    return "---" in s and not s.strip("|:- ")


def make_preview(text: str | None) -> str:
    text = "\n".join(l for l in (text or "")[:PREVIEW_INPUT_CAP].split("\n") if not _is_separator_line(l))
    for rx, rep in _MD_STRIP:
        text = rx.sub(rep, text)
    return text.strip()[:100]


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _cursor(c: Conversation) -> str:
    return f"{int(c.pinned)}~{c.updated_at.astimezone(UTC).isoformat()}~{c.id}"


def _parse_cursor(before: str) -> tuple[bool, datetime, uuid.UUID | None]:
    """`next_before` token "<0|1>~<iso>~<uuid>". Older forms still work: "<0|1>~<iso>" (no tie-breaker) and a
    bare ISO timestamp (= unpinned, older than)."""
    bad = ApiError(422, "invalid_request", "before must be a timestamp or a next_before token")
    parts = before.split("~")
    pinned, last_id = False, None
    if parts[0] in ("0", "1") and len(parts) in (2, 3):
        pinned, ts = parts[0] == "1", parts[1]
        if len(parts) == 3:
            try:
                last_id = uuid.UUID(parts[2])
            except ValueError:
                raise bad from None
    elif len(parts) == 1:
        ts = before
    else:
        raise bad
    try:
        when = datetime.fromisoformat(ts.replace("Z", "+00:00").replace(" ", "+"))
    except ValueError:
        raise bad from None
    return pinned, when if when.tzinfo else when.replace(tzinfo=UTC), last_id


FINISHED = ("complete", "error", "stopped")


@router.get("")
async def list_conversations(
    limit: int = Query(50, ge=1, le=100),
    before: str | None = Query(None, max_length=100),
    q: str | None = Query(None, max_length=200),
    user: User = Depends(active_user),
    db: AsyncSession = Depends(get_db),
):
    """Pinned first, then updated_at desc. `next_before` (null on the last page) is the cursor for `before`."""
    last_asst = (
        select(Message.status, func.left(func.ltrim(Message.content), PREVIEW_INPUT_CAP).label("content"), Message.updated_at)
        .where(Message.conversation_id == Conversation.id, Message.role == "assistant")
        .order_by(Message.created_at.desc())
        .limit(1)
        .lateral("last_asst")
    )
    last_any = (
        select(func.left(func.ltrim(Message.content), PREVIEW_INPUT_CAP).label("content"))
        .where(Message.conversation_id == Conversation.id, Message.content != "")
        .order_by(Message.created_at.desc())
        .limit(1)
        .lateral("last_any")
    )
    stmt = (
        select(
            Conversation,
            last_asst.c.status.label("last_status"),
            last_asst.c.content.label("asst_content"),
            last_asst.c.updated_at.label("asst_finished"),
            last_any.c.content.label("any_content"),
        )
        .select_from(Conversation)
        .outerjoin(last_asst, true())
        .outerjoin(last_any, true())
        .where(Conversation.user_id == user.id)
    )
    if q and q.strip():
        like = _like(q.strip())
        stmt = stmt.where(
            or_(
                Conversation.title.ilike(like, escape="\\"),
                exists().where(Message.conversation_id == Conversation.id, Message.content.ilike(like, escape="\\")),
            )
        )
    if before:
        c_pinned, c_ts, c_id = _parse_cursor(before)
        # rows after the cursor in ORDER BY pinned DESC, updated_at DESC, id ASC
        later = Conversation.updated_at < c_ts
        if c_id is not None:
            later = or_(later, and_(Conversation.updated_at == c_ts, Conversation.id > c_id))
        same_group = and_(Conversation.pinned == literal(c_pinned), later)
        stmt = stmt.where(or_(Conversation.pinned == literal(False), same_group) if c_pinned else same_group)
    rows = (
        await db.execute(stmt.order_by(Conversation.pinned.desc(), Conversation.updated_at.desc(), Conversation.id).limit(limit + 1))
    ).all()
    more = len(rows) > limit
    rows = rows[:limit]
    items = []
    for r in rows:
        c: Conversation = r.Conversation
        status = r.last_status or "idle"
        unread = bool(
            r.last_status in FINISHED and (c.last_read_at is None or r.asst_finished > c.last_read_at)
        )
        items.append(
            {
                "id": str(c.id),
                "title": c.title,
                "model": c.model,
                "updated_at": iso(c.updated_at),
                "status": status,
                "unread": unread,
                "preview": make_preview(r.asst_content or r.any_content),
                "pinned": c.pinned,
            }
        )
    next_before = _cursor(rows[-1].Conversation) if more and rows else None
    return {"items": items, "next_before": next_before}


@router.post("", status_code=201)
async def create_conversation(
    body: CreateConversation, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)
):
    model = choose_model(body.model)
    conv = Conversation(user_id=user.id, title=(body.title or "").strip(), model=model.id)
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
async def update_conversation(
    conversation_id: uuid.UUID,
    body: PatchConversation,
    user: User = Depends(active_user),
    db: AsyncSession = Depends(get_db),
):
    conv = await owned_conversation(db, user, conversation_id)
    if body.title is None and body.pinned is None:
        raise ApiError(422, "invalid_request", "Nothing to update: send title and/or pinned")
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise ApiError(422, "invalid_request", "title must not be empty")
        conv.title = title
    if body.pinned is not None:
        conv.pinned = body.pinned
    await db.commit()
    return {"conversation": conversation_json(conv)}


@router.post("/{conversation_id}/read", status_code=204)
async def mark_read(
    conversation_id: uuid.UUID, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)
) -> Response:
    conv = await owned_conversation(db, user, conversation_id)
    conv.last_read_at = datetime.now(UTC)
    await db.commit()
    return Response(status_code=204)


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
    model = choose_model(body.model, conv)
    level = choose_level(model, body.reasoning)

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
            model=model.id,
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
        conv.model = model.id
        conv.updated_at = now
        await db.commit()
    except BaseException:
        registry.release(conv.id)
        raise

    state = RunState(asst, conv.id, user.id)
    provider = ReplayProvider() if model.id.startswith("replay:") else OpenAIProvider()
    ctx = RunContext(
        state,
        user_id=user.id,
        conversation_id=conv.id,
        user_message_id=user_msg.id,
        model=model.id,
        level=level,
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

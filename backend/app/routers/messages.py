import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import active_user
from app.errors import ApiError
from app.models import Conversation, Message, User
from app.routers.conversations import attachments_by_message
from app.services.runs import sse_response, ev, message_json, registry, sse, stream_events

router = APIRouter(prefix="/api/messages", tags=["messages"])


async def _owned_message(db: AsyncSession, user: User, message_id: uuid.UUID) -> Message:
    msg = await db.get(Message, message_id)
    if msg is None:
        raise ApiError(404, "not_found", "Message not found")
    conv = await db.get(Conversation, msg.conversation_id)
    if conv is None or conv.user_id != user.id:
        raise ApiError(404, "not_found", "Message not found")
    return msg


@router.get("/{message_id}/events")
async def message_events(message_id: uuid.UUID, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)):
    msg = await _owned_message(db, user, message_id)
    state = registry.get(msg.id)
    if state is not None:
        # subscribe and snapshot in the same synchronous step: no event can fall in between
        q = state.subscribe()
        head = [ev("snapshot", {"message": state.snapshot()})]
        await db.commit()
        return sse_response(stream_events(state, q, head))

    atts = await attachments_by_message(db, [msg])
    await db.commit()

    async def finished():
        yield sse(ev("snapshot", {"message": message_json(msg, atts.get(msg.id, []))}))
        done = {"message_id": str(msg.id), "status": msg.status}
        if msg.error:
            done["error"] = msg.error
        yield sse(ev("done", done))

    return sse_response(finished())


@router.post("/{message_id}/stop", status_code=202)
async def stop_message(message_id: uuid.UUID, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)):
    msg = await _owned_message(db, user, message_id)
    await registry.stop(msg.id)
    return Response(status_code=202)

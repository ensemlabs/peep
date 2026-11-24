"""In-process agent runs: state, subscribers (SSE), throttled persistence, stop."""

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from fastapi.sse import KEEPALIVE_COMMENT, EventSourceResponse, format_sse_event
from sqlalchemy import text, update

from app.db import get_sessionmaker
from app.models import Conversation, Message
from app.providers.base import Provider, ProviderError, RunContext, new_id
from app.schemas import iso
from app.services.quota import record_usage
from app.services.usage import estimate_usage

log = logging.getLogger(__name__)

FLUSH_INTERVAL = 1.0
KEEPALIVE_SECONDS = 15.0
_TERMINAL = {"done", "error"}

Event = tuple[str, str]  # (event name, JSON data)


def now_iso() -> str:
    return iso(datetime.now(UTC)) or ""


def root_text(parts: list[dict[str, Any]]) -> str:
    return "\n\n".join(p["text"] for p in parts if p.get("type") == "text" and p.get("text"))


def message_json(msg: Message, attachments: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": str(msg.id),
        "role": msg.role,
        "content": msg.content,
        "attachments": attachments,
        "parts": msg.parts or [],
        "status": msg.status,
        "model": msg.model,
        "error": msg.error,
        "usage": msg.usage,
        "created_at": iso(msg.created_at),
    }


def sse(event: Event) -> bytes:
    return format_sse_event(event=event[0], data_str=event[1])


def sse_response(stream: AsyncIterator[bytes]) -> EventSourceResponse:
    return EventSourceResponse(stream, headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def ev(name: str, data: dict[str, Any]) -> Event:
    return (name, json.dumps(data, separators=(",", ":")))


class RunState:
    def __init__(self, message: Message, conversation_id: uuid.UUID, user_id: uuid.UUID):
        self.message_id = message.id
        self.conversation_id = conversation_id
        self.user_id = user_id
        self.model = message.model
        self.created_at = message.created_at
        self.parts: list[dict[str, Any]] = []
        self.status = "streaming"
        self.error: str | None = None
        self.usage: dict[str, Any] | None = None
        self.usage_hint: dict[str, Any] = {"input_tokens": 0, "ratio": 1.0}  # set by the provider for estimates
        self.task: asyncio.Task | None = None
        self.finalizing = False  # the provider is done; stop() no longer cancels (the final write must complete)
        self._index: dict[str, dict[str, Any]] = {}
        self._subscribers: set[asyncio.Queue[Event | None]] = set()
        self._dirty = False
        self._flush_lock = asyncio.Lock()

    # -- subscribers ---------------------------------------------------------------------------

    def subscribe(self) -> asyncio.Queue[Event | None]:
        q: asyncio.Queue[Event | None] = asyncio.Queue()
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def _publish(self, event: Event | None) -> None:
        for q in self._subscribers:
            q.put_nowait(event)

    def snapshot(self) -> dict[str, Any]:
        return {
            "id": str(self.message_id),
            "role": "assistant",
            "content": root_text(self.parts),
            "attachments": [],
            "parts": self.parts,
            "status": self.status,
            "model": self.model,
            "error": self.error,
            "usage": self.usage,
            "created_at": iso(self.created_at),
        }

    # -- emitting (called by providers through RunContext) -------------------------------------

    def _register(self, part: dict[str, Any]) -> None:
        self._index[part["id"]] = part
        for child in part.get("parts", []):
            self._register(child)

    def _find(self, part_id: str) -> dict[str, Any]:
        try:
            return self._index[part_id]
        except KeyError:
            raise ValueError(f"unknown part id {part_id!r}") from None

    async def emit_part(self, part: dict[str, Any], parent_id: str | None = None) -> dict[str, Any]:
        part.setdefault("id", new_id())
        t = part.get("type")
        if t in ("thinking", "tool", "subagent"):
            part.setdefault("status", "running")
            part.setdefault("started_at", now_iso())
        if t in ("thinking", "text"):
            part.setdefault("text", "")
        elif t == "tool":
            part.setdefault("input", None)
            part.setdefault("output", None)
            part.setdefault("files", [])
        elif t == "subagent":
            part.setdefault("name", "")
            part.setdefault("task", "")
            part.setdefault("parts", [])
        elif t == "files":
            part.setdefault("files", [])
        siblings = self.parts if parent_id is None else self._find(parent_id).setdefault("parts", [])
        siblings.append(part)
        self._register(part)
        self._publish(ev("part", {"message_id": str(self.message_id), "parent_id": parent_id, "part": part}))
        if "status" in part or t == "files":
            await self.flush()
        else:
            self._dirty = True
        return part

    async def emit_delta(self, part_id: str, field: str, text_: str) -> None:
        part = self._find(part_id)
        part[field] = (part.get(field) or "") + text_
        self._dirty = True
        self._publish(
            ev("delta", {"message_id": str(self.message_id), "part_id": part_id, "field": field, "text": text_})
        )

    async def emit_update(self, part_id: str, patch: dict[str, Any]) -> None:
        part = self._find(part_id)
        patch = dict(patch)
        if patch.get("status") in _TERMINAL and not part.get("ended_at") and "ended_at" not in patch:
            patch["ended_at"] = now_iso()
        part.update(patch)
        self._publish(ev("update", {"message_id": str(self.message_id), "part_id": part_id, "patch": patch}))
        if "status" in patch:
            await self.flush()
        else:
            self._dirty = True

    async def emit_usage(self, usage: dict[str, Any]) -> None:
        self.usage = usage
        self._publish(ev("usage", {"message_id": str(self.message_id), "usage": usage}))

    # -- persistence ---------------------------------------------------------------------------

    async def flush(self) -> None:
        async with self._flush_lock:
            payload = json.dumps(self.parts)
            content = root_text(self.parts)
            self._dirty = False
            async with get_sessionmaker()() as db:
                await db.execute(
                    text(
                        "UPDATE messages SET parts = CAST(:parts AS jsonb), content = :content, updated_at = now()"
                        " WHERE id = :id"
                    ),
                    {"parts": payload, "content": content, "id": self.message_id},
                )
                await db.commit()

    async def flush_loop(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_INTERVAL)
            if self._dirty:
                try:
                    await self.flush()
                except Exception:
                    log.exception("periodic flush failed")

    # -- completion ----------------------------------------------------------------------------

    async def close_running(self, final_status: str) -> None:
        stack = list(self.parts)
        running = []
        while stack:
            p = stack.pop()
            stack.extend(p.get("parts", []))
            if p.get("status") == "running":
                running.append(p)
        for p in running:
            ok = p["type"] == "thinking" or final_status == "complete"
            await self.emit_update(p["id"], {"status": "done" if ok else "error"})

    def _texts(self) -> tuple[str, str]:
        """(answer text, thinking text) over the whole part tree; tool output counts as answer text."""
        answer: list[str] = []
        thinking: list[str] = []
        stack = list(self.parts)
        while stack:
            p = stack.pop(0)
            stack = list(p.get("parts", [])) + stack
            if p.get("type") == "thinking":
                thinking.append(p.get("text") or "")
            elif p.get("type") == "text":
                answer.append(p.get("text") or "")
            elif p.get("type") == "tool" and p.get("output"):
                answer.append(p["output"])
        return "".join(answer), "".join(thinking)

    async def ensure_usage(self, status: str) -> None:
        """Estimate usage when the provider reported none (stop, partial error, estimate-only providers).

        Never fails the run: an estimation problem just means no usage for this message.
        """
        if self.usage is not None or (status == "error" and not self.parts):
            return
        try:
            answer, thinking = self._texts()
            usage = await asyncio.to_thread(
                estimate_usage, self.usage_hint["input_tokens"], answer, thinking, self.usage_hint["ratio"]
            )
            await self.emit_usage(usage)
        except Exception:
            log.warning("usage estimation failed for message %s; continuing without usage", self.message_id, exc_info=True)

    async def finish(self, status: str, error: str | None) -> None:
        self.status, self.error = status, error
        try:
            await self.flush()
            async with get_sessionmaker()() as db:
                await db.execute(
                    update(Message).where(Message.id == self.message_id).values(status=status, error=error, usage=self.usage)
                )
                await db.execute(
                    update(Conversation).where(Conversation.id == self.conversation_id).values(updated_at=datetime.now(UTC))
                )
                total = (self.usage or {}).get("total_tokens") or 0
                if total > 0:
                    record_usage(db, self.user_id, self.message_id, int(total))
                await db.commit()
        except Exception:
            log.exception("final persist failed for message %s", self.message_id)
        done: dict[str, Any] = {"message_id": str(self.message_id), "status": status}
        if error:
            done["error"] = error
        self._publish(ev("done", done))
        self._publish(None)


class RunRegistry:
    def __init__(self) -> None:
        self._runs: dict[uuid.UUID, RunState] = {}
        self._busy: set[uuid.UUID] = set()
        self._owners: dict[uuid.UUID, uuid.UUID] = {}  # conversation -> user, for the per-user run cap

    def is_busy(self, conversation_id: uuid.UUID) -> bool:
        return conversation_id in self._busy

    def reserve(self, conversation_id: uuid.UUID) -> bool:
        """Synchronously claim a conversation (no await between check and claim)."""
        if conversation_id in self._busy:
            return False
        self._busy.add(conversation_id)
        return True

    def reserve_user(self, conversation_id: uuid.UUID, user_id: uuid.UUID, max_runs: int) -> bool:
        """Claim one of the user's `max_runs` concurrent run slots (quota is only recorded when a run ends)."""
        if sum(1 for u in self._owners.values() if u == user_id) >= max_runs:
            return False
        self._owners[conversation_id] = user_id
        return True

    def release(self, conversation_id: uuid.UUID) -> None:
        self._busy.discard(conversation_id)
        self._owners.pop(conversation_id, None)

    def get(self, message_id: uuid.UUID) -> RunState | None:
        return self._runs.get(message_id)

    def start(self, state: RunState, provider: Provider, ctx: RunContext) -> None:
        self._runs[state.message_id] = state
        state.task = asyncio.create_task(self._run(state, provider, ctx), name=f"run-{state.message_id}")

    async def _run(self, state: RunState, provider: Provider, ctx: RunContext) -> None:
        flusher = asyncio.create_task(state.flush_loop())
        status, error = "complete", None
        try:
            await provider.run(ctx)
        except asyncio.CancelledError:
            status = "stopped"
        except ProviderError as e:
            status, error = "error", str(e)
        except Exception:
            log.exception("run %s crashed", state.message_id)
            status, error = "error", "Internal error"
        finally:
            flusher.cancel()
        state.finalizing = True  # no await since the provider ended, so a second stop() cannot slip in
        try:
            # Shielded: a late cancel (shutdown) must not abandon the final DB write halfway.
            await asyncio.shield(self._finalize(state, status, error))
        finally:
            self._runs.pop(state.message_id, None)
            self.release(state.conversation_id)

    @staticmethod
    async def _finalize(state: RunState, status: str, error: str | None) -> None:
        try:
            await state.close_running(status)
        except Exception:
            log.exception("closing parts failed")
        await state.ensure_usage(status)
        await state.finish(status, error)

    async def stop(self, message_id: uuid.UUID) -> bool:
        state = self._runs.get(message_id)
        if state is None or state.task is None:
            return False
        if not state.finalizing:
            state.task.cancel()
        return True

    async def wait_idle(self, timeout: float = 30) -> None:
        tasks = [s.task for s in self._runs.values() if s.task]
        if tasks:
            await asyncio.wait(tasks, timeout=timeout)

    async def shutdown(self) -> None:
        for s in list(self._runs.values()):
            if s.task:
                s.task.cancel()
        await self.wait_idle(10)


registry = RunRegistry()


async def stream_events(
    state: RunState, q: asyncio.Queue[Event | None], head: list[Event]
) -> AsyncIterator[bytes]:
    """SSE byte stream: `head` events, then live events until the run is done. Disconnect only unsubscribes."""
    try:
        for e in head:
            yield sse(e)
        while True:
            try:
                item = await asyncio.wait_for(q.get(), KEEPALIVE_SECONDS)
            except TimeoutError:
                yield KEEPALIVE_COMMENT
                continue
            if item is None:
                return
            yield sse(item)
    finally:
        state.unsubscribe(q)


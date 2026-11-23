import logging
import mimetypes

import openai
from openai import AsyncOpenAI

from app.config import get_settings
from app.db import get_sessionmaker
from app.providers.base import ProviderError, RunContext, new_id
from app.providers.datauri import StreamingImageExtractor
from app.services.history import build_openai_messages
from app.services.runs import now_iso

log = logging.getLogger(__name__)


def _reasoning_delta(delta) -> str | None:
    value = getattr(delta, "reasoning_content", None)
    if value is None:
        extra = getattr(delta, "model_extra", None) or {}
        value = extra.get("reasoning_content")
    return value if isinstance(value, str) and value else None


class _Emitter:
    """Maps the model's delta stream to thinking / text / files parts."""

    def __init__(self, ctx: RunContext):
        self.ctx = ctx
        self.thinking_id: str | None = None
        self.text_id: str | None = None
        self.extractor = StreamingImageExtractor()
        self.image_n = 0

    async def reasoning(self, text: str) -> None:
        if self.thinking_id is None:
            self.thinking_id = new_id()
            await self.ctx.emit_part({"id": self.thinking_id, "type": "thinking", "text": "", "status": "running"})
        await self.ctx.emit_delta(self.thinking_id, "text", text)

    async def close_thinking(self) -> None:
        if self.thinking_id:
            await self.ctx.emit_update(self.thinking_id, {"status": "done", "ended_at": now_iso()})
            self.thinking_id = None

    async def content(self, text: str) -> None:
        await self.close_thinking()
        await self._segments(self.extractor.feed(text))

    async def finish(self) -> None:
        await self.close_thinking()
        await self._segments(self.extractor.flush())

    async def _segments(self, segments: list[tuple]) -> None:
        for seg in segments:
            if seg[0] == "text":
                if self.text_id is None:
                    self.text_id = new_id()
                    await self.ctx.emit_part({"id": self.text_id, "type": "text", "text": ""})
                await self.ctx.emit_delta(self.text_id, "text", seg[1])
            else:
                _, _alt, mime, data = seg
                self.text_id = None
                self.image_n += 1
                ext = mimetypes.guess_extension(mime) or ".png"
                name = f"image-{self.image_n}{ext}"
                meta = await self.ctx.store_file(data, mime, name)
                await self.ctx.emit_part({"id": new_id(), "type": "files", "files": [meta]})


def _error_text(e: Exception) -> str:
    if isinstance(e, openai.APITimeoutError):
        return "The model did not respond in time"
    if isinstance(e, openai.APIConnectionError):
        return "Could not reach the model service"
    if isinstance(e, openai.APIStatusError):
        return f"Model service error {e.status_code}: {e.message}"[:500]
    return f"Model error: {getattr(e, 'message', None) or e}"[:500]


class OpenAIProvider:
    async def run(self, ctx: RunContext) -> None:
        s = get_settings()
        async with get_sessionmaker()() as db:
            messages = await build_openai_messages(db, ctx.conversation_id, ctx.user_message_id)
        kwargs: dict = {"model": ctx.model, "messages": messages, "stream": True}
        if ctx.reasoning:
            kwargs["reasoning_effort"] = "high"
        client = AsyncOpenAI(
            base_url=s.llm_base_url, api_key=s.llm_api_key or "none", timeout=s.llm_timeout_seconds, max_retries=0
        )
        emitter = _Emitter(ctx)
        try:
            stream = await client.chat.completions.create(**kwargs)
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta is None:
                    continue
                if (r := _reasoning_delta(delta)) is not None:
                    await emitter.reasoning(r)
                if delta.content:
                    await emitter.content(delta.content)
            await emitter.finish()
        except openai.OpenAIError as e:
            raise ProviderError(_error_text(e)) from e
        finally:
            await client.close()

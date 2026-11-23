import asyncio
import logging
import mimetypes

import openai

from app.db import get_sessionmaker
from app.providers.base import ProviderError, RunContext, new_id
from app.providers.datauri import StreamingImageExtractor
from app.providers.tagsplit import ThinkTagSplitter
from app.services import model_registry, tokens
from app.services.history import build_openai_messages
from app.services.runs import now_iso
from app.services.usage import normalize_usage

log = logging.getLogger(__name__)


def _reasoning_delta(delta, fields: list[str]) -> str | None:
    extra = getattr(delta, "model_extra", None) or {}
    for name in fields:
        value = getattr(delta, name, None)
        if value is None:
            value = extra.get(name)
        if isinstance(value, str) and value:
            return value
    return None


class _Emitter:
    """Maps the model's delta stream to thinking / text / files parts."""

    def __init__(self, ctx: RunContext, parse_tags: bool, tag_names: list[str]):
        self.ctx = ctx
        self.thinking_id: str | None = None
        self.text_id: str | None = None
        self.extractor = StreamingImageExtractor()
        self.splitter = ThinkTagSplitter(tag_names) if parse_tags else None
        self.image_n = 0

    async def reasoning(self, text: str) -> None:
        if self.thinking_id is None:
            await self._segments(self.extractor.flush())  # text held back by the image extractor goes first
            self.thinking_id = new_id()
            self.text_id = None
            await self.ctx.emit_part({"id": self.thinking_id, "type": "thinking", "text": "", "status": "running"})
        await self.ctx.emit_delta(self.thinking_id, "text", text)

    async def close_thinking(self) -> None:
        if self.thinking_id:
            await self.ctx.emit_update(self.thinking_id, {"status": "done", "ended_at": now_iso()})
            self.thinking_id = None

    async def content(self, text: str) -> None:
        if self.splitter is None:
            await self._text(text)
        else:
            await self._tagged(self.splitter.feed(text))

    async def _tagged(self, segs: list[tuple[str, str]]) -> None:
        for kind, text in segs:
            if kind == "thinking":
                await self.reasoning(text)
            else:
                await self._text(text)

    async def _text(self, text: str) -> None:
        await self.close_thinking()
        await self._segments(self.extractor.feed(text))

    async def finish(self) -> None:
        if self.splitter is not None:
            await self._tagged(self.splitter.flush())
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
                meta = await self.ctx.store_file(data, mime, f"image-{self.image_n}{ext}")
                await self.ctx.emit_part({"id": new_id(), "type": "files", "files": [meta]})


def _error_text(e: Exception) -> str:
    if isinstance(e, openai.APITimeoutError):
        return "The model did not respond in time"
    if isinstance(e, openai.APIConnectionError):
        return "Could not reach the model service"
    if isinstance(e, openai.APIStatusError):
        return f"Model service error {e.status_code}: {e.message}"[:500]
    return f"Model error: {getattr(e, 'message', None) or e}"[:500]


def build_request(model: model_registry.ResolvedModel, messages: list, level_id: str | None) -> dict:
    """Keyword arguments for chat.completions.create (level patch merged)."""
    base = {"model": model.upstream, "messages": messages, "stream": True, "stream_options": {"include_usage": True}}
    level = model.level(level_id)
    patch = level.patch if level else {}
    kwargs, extra = model_registry.build_request_params(base, patch)
    if extra:
        kwargs["extra_body"] = extra
    return kwargs


class OpenAIProvider:
    async def run(self, ctx: RunContext) -> None:
        model = model_registry.get_registry().get(ctx.model)
        if model is None:
            raise ProviderError("The selected model is not configured")
        async with get_sessionmaker()() as db:
            messages = await build_openai_messages(db, ctx.conversation_id, ctx.user_message_id)
        kwargs = build_request(model, messages, ctx.level)
        read_from = model.cfg.thinking.read_from if model.cfg.thinking else model_registry.ReadFrom()
        ctx.set_usage_hint(
            await asyncio.to_thread(tokens.count_messages, messages, model.cfg.image_tokens, model.cfg.token_ratio),
            model.cfg.token_ratio,
        )
        client = model_registry.client_for(model)
        emitter = _Emitter(ctx, read_from.parse_tags, read_from.tag_names)
        real_usage = None
        try:
            stream = await client.chat.completions.create(**kwargs)
            async for chunk in stream:
                if getattr(chunk, "usage", None) is not None:
                    real_usage = chunk.usage.model_dump()
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta is None:
                    continue
                if (r := _reasoning_delta(delta, read_from.delta_fields)) is not None:
                    await emitter.reasoning(r)
                if delta.content:
                    await emitter.content(delta.content)
            await emitter.finish()
        except openai.OpenAIError as e:
            raise ProviderError(_error_text(e)) from e

        usage = normalize_usage(real_usage) if model.usage_mode == "provider" else None
        if usage is not None:
            await ctx.emit_usage(usage)
        # otherwise the run estimates it (RunState.ensure_usage) from the prompt size set above and the parts

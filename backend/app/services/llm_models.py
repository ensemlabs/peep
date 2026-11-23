"""Model catalogue: upstream OpenAI-compatible /models filtered by an allowlist, plus replay fixtures."""

import logging
import time

from openai import AsyncOpenAI

from app.config import get_settings

log = logging.getLogger(__name__)

CACHE_TTL = 60.0
_cache: tuple[float, list[str]] | None = None


def clear_cache() -> None:
    global _cache
    _cache = None


def pretty_label(model_id: str) -> str:
    return " ".join(w.capitalize() for w in model_id.replace("_", "-").split("-") if w)


async def _upstream_ids() -> list[str] | None:
    s = get_settings()
    client = AsyncOpenAI(base_url=s.llm_base_url, api_key=s.llm_api_key or "none", timeout=5, max_retries=0)
    try:
        page = await client.models.list()
        return [m.id for m in page.data]
    except Exception as e:
        log.warning("upstream /models failed (%s); falling back to allowlist", type(e).__name__)
        return None
    finally:
        await client.close()


async def openai_model_ids() -> list[str]:
    global _cache
    now = time.monotonic()
    if _cache and now - _cache[0] < CACHE_TTL:
        return _cache[1]
    allow = get_settings().llm_model_allowlist
    upstream = await _upstream_ids()
    if upstream is None:
        ids = allow  # also not cached long: retry soon
        _cache = (now - CACHE_TTL + 10, ids)
        return ids
    ids = [m for m in allow if m in upstream] if allow else upstream
    if not ids:
        ids = allow
    _cache = (now, ids)
    return ids


async def list_models() -> dict:
    from app.providers.replay_provider import list_fixture_names

    s = get_settings()
    items = [
        {"id": m, "label": pretty_label(m), "provider": "openai", "reasoning": True}
        for m in await openai_model_ids()
    ]
    if s.replay_enabled:
        for name in list_fixture_names():
            items.append(
                {
                    "id": f"replay:{name}",
                    "label": f"Replay · {name.replace('-', ' ').capitalize()}",
                    "provider": "replay",
                    "reasoning": False,
                }
            )
    default = s.llm_default_model
    if default not in {i["id"] for i in items}:
        default = items[0]["id"] if items else None
    return {"items": items, "default": default}

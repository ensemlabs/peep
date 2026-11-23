"""Normalise provider usage payloads into the API's Usage shape, or estimate it."""

from typing import Any


def _int(v: Any) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else None


def _get(d: dict[str, Any], *path: str) -> Any:
    for p in path:
        if not isinstance(d, dict):
            return None
        d = d.get(p)  # type: ignore[assignment]
    return d


def make_usage(
    input_tokens: int,
    output_tokens: int,
    reasoning: int | None = None,
    cache_read: int | None = None,
    cache_write: int | None = None,
    source: str = "provider",
) -> dict[str, Any]:
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "reasoning_tokens": reasoning,
        "cache_read_tokens": cache_read,
        "cache_write_tokens": cache_write,
        "total_tokens": input_tokens + output_tokens,
        "source": source,
    }


def normalize_usage(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    """OpenAI / DeepSeek / Anthropic-style usage dict -> Usage, or None if there is nothing usable."""
    if not raw:
        return None
    inp = _int(raw.get("prompt_tokens"))
    if inp is None:
        inp = _int(raw.get("input_tokens"))
    out = _int(raw.get("completion_tokens"))
    if out is None:
        out = _int(raw.get("output_tokens"))
    if inp is None or out is None:
        return None
    reasoning = _int(_get(raw, "completion_tokens_details", "reasoning_tokens"))
    cache_read = _int(_get(raw, "prompt_tokens_details", "cached_tokens"))
    for key in ("prompt_cache_hit_tokens", "cache_read_input_tokens"):
        if cache_read is None:
            cache_read = _int(raw.get(key))
    cache_write = _int(raw.get("cache_creation_input_tokens"))
    return make_usage(inp, out, reasoning, cache_read, cache_write, "provider")


def estimate_usage(input_tokens: int, answer_text: str, thinking_text: str, ratio: float = 1.0) -> dict[str, Any]:
    """The one estimation rule: output = answer + thinking tokens (as OpenAI counts reasoning), cache unknown."""
    from app.services import tokens

    reasoning = tokens.count_text(thinking_text, ratio)
    output = tokens.count_text(answer_text, ratio) + reasoning
    return make_usage(input_tokens, output, reasoning or None, None, None, "estimate")

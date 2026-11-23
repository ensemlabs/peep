"""Token estimation with tiktoken (o200k_base). The BPE file is baked into the image (TIKTOKEN_CACHE_DIR)."""

from functools import cache
from typing import Any

import tiktoken


@cache
def _encoding() -> tiktoken.Encoding:
    return tiktoken.get_encoding("o200k_base")


def count_text(text: str, ratio: float = 1.0) -> int:
    if not text:
        return 0
    n = len(_encoding().encode(text, disallowed_special=()))
    return max(1, round(n * ratio))


def count_messages(messages: list[dict[str, Any]], image_tokens: int, ratio: float = 1.0) -> int:
    """Estimate prompt tokens of OpenAI-style messages (images count `image_tokens` each)."""
    total = 0
    for m in messages:
        content = m.get("content")
        if isinstance(content, str):
            total += count_text(content, ratio)
        elif isinstance(content, list):
            for part in content:
                if part.get("type") == "text":
                    total += count_text(part.get("text", ""), ratio)
                elif part.get("type") == "image_url":
                    total += image_tokens
    return total

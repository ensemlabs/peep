import base64
import os
import time

import pytest

from app.providers.datauri import INVALID, StreamingImageExtractor


def run(chunks):
    ex = StreamingImageExtractor()
    segs = []
    for c in chunks:
        segs += ex.feed(c)
    segs += ex.flush()
    merged = []
    for s in segs:
        if s[0] == "text" and merged and merged[-1][0] == "text":
            merged[-1] = ("text", merged[-1][1] + s[1])
        else:
            merged.append(s)
    return merged


DATA = b"\x89PNG\r\n\x1a\n" + bytes(range(64))
B64 = base64.b64encode(DATA).decode()
MD = f"before ![a red apple](data:image/png;base64,{B64}) after"
EXPECTED = [("text", "before "), ("image", "a red apple", "image/png", DATA), ("text", " after")]


def test_single_chunk():
    assert run([MD]) == EXPECTED


@pytest.mark.parametrize("i", range(1, len(MD)))
def test_every_split_point(i):
    assert run([MD[:i], MD[i:]]) == EXPECTED


def test_char_by_char():
    assert run(list(MD)) == EXPECTED


def test_two_images_and_text_between():
    md = f"![](data:image/png;base64,{B64})mid![x](data:image/jpeg;base64,{B64})"
    assert run([md[:30], md[30:]]) == [
        ("image", "", "image/png", DATA),
        ("text", "mid"),
        ("image", "x", "image/jpeg", DATA),
    ]


def test_plain_text_and_regular_markdown_untouched():
    for md in ["no images here!", "! not ![an image", "![alt](https://x.test/a.png) and ![b](data:text/plain;base64,AAAA)", "wow!"]:
        assert run([md]) == [("text", md)]
        assert run(list(md)) == [("text", md)]


def test_text_is_not_delayed_unnecessarily():
    ex = StreamingImageExtractor()
    assert ex.feed("Hello world, ") == [("text", "Hello world, ")]
    assert ex.feed("see!") == [("text", "see")]  # only a trailing '!' is held back
    assert ex.flush() == [("text", "!")]


@pytest.mark.parametrize(
    "payload",
    ["@@@@", B64[:-3], "A", B64 + "=="],
)
def test_malformed_payload_replaced(payload):
    segs = run([f"x ![a](data:image/png;base64,{payload}) y"])
    assert segs == [("text", f"x {INVALID} y")]


def test_unterminated_image_flushes_as_invalid():
    segs = run([f"x ![a](data:image/png;base64,{B64[:20]}"])
    assert segs == [("text", f"x {INVALID}")]


def test_unterminated_head_flushes_as_text():
    assert run(["x ![a](data:ima"]) == [("text", "x ![a](data:ima")]


def test_huge_payload_single_delta_and_chunked_performance():
    big = os.urandom(9 * 1024 * 1024)
    md = f"![big](data:image/png;base64,{base64.b64encode(big).decode()})tail"
    t = time.perf_counter()
    assert run([md]) == [("image", "big", "image/png", big), ("text", "tail")]
    chunks = [md[i : i + 8192] for i in range(0, len(md), 8192)]
    assert run(chunks) == [("image", "big", "image/png", big), ("text", "tail")]
    assert time.perf_counter() - t < 5

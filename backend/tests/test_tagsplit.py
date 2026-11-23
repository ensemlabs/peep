import pytest

from app.providers.tagsplit import ThinkTagSplitter


def run(chunks, tags=("think", "thought")):
    sp = ThinkTagSplitter(list(tags))
    segs = []
    for c in chunks:
        segs += sp.feed(c)
    segs += sp.flush()
    merged = []
    for k, t in segs:
        if merged and merged[-1][0] == k:
            merged[-1] = (k, merged[-1][1] + t)
        else:
            merged.append((k, t))
    return merged


TEXT = "<think>let me think\n</think>\n\nThe answer is 4."
EXPECTED = [("thinking", "let me think\n"), ("text", "The answer is 4.")]


def test_single_chunk():
    assert run([TEXT]) == EXPECTED


@pytest.mark.parametrize("i", range(1, len(TEXT)))
def test_every_split_point(i):
    assert run([TEXT[:i], TEXT[i:]]) == EXPECTED


def test_char_by_char():
    assert run(list(TEXT)) == EXPECTED


@pytest.mark.parametrize("i", range(1, 40))
def test_thought_tag_name_every_split(i):
    t = "<thought>plan</thought>done"
    assert run([t[:i], t[i:]]) == [("thinking", "plan"), ("text", "done")]


def test_plain_text_with_angle_brackets_untouched():
    for t in ["a < b and c > d", "<div>html</div>", "x <thin", "1 << 2", "<", "<thin", "<thinking>not a tag</thinking>"]:
        assert run([t]) == [("text", t)]
        assert run(list(t)) == [("text", t)]


def test_text_not_delayed_without_angle_bracket():
    sp = ThinkTagSplitter(["think"])
    assert sp.feed("hello world") == [("text", "hello world")]


def test_unclosed_tag_flushes_as_thinking():
    assert run(["<think>never closed"]) == [("thinking", "never closed")]


def test_only_the_leading_block_is_recognised():
    md = "<think>a</think>x <think>literal</think> y"
    assert run([md]) == [("thinking", "a"), ("text", "x <think>literal</think> y")]
    assert run(list(md)) == [("thinking", "a"), ("text", "x <think>literal</think> y")]


def test_literal_tag_inside_code_block_stays_text():
    md = "Use it like this:\n```html\n<think>not thinking</think>\n```\nDone."
    assert run([md]) == [("text", md)]
    for i in range(1, len(md)):
        assert run([md[:i], md[i:]]) == [("text", md)]


def test_leading_whitespace_before_tag_is_allowed():
    assert run(["  \n<think>a</think>b"]) == [("thinking", "a"), ("text", "b")]
    assert run(["  ", "\n<thi", "nk>a</think>b"]) == [("thinking", "a"), ("text", "b")]
    assert run(["   plain text"]) == [("text", "   plain text")]
    assert run(["   "]) == [("text", "   ")]


def test_only_configured_tags():
    assert run(["<thought>a</thought>b"], tags=("think",)) == [("text", "<thought>a</thought>b")]


def test_composes_with_image_extractor():
    import base64

    from app.providers.datauri import StreamingImageExtractor

    data = b"\x89PNG" + bytes(40)
    md = f"<think>hmm</think>look ![x](data:image/png;base64,{base64.b64encode(data).decode()}) done"
    for i in range(1, len(md)):
        sp, ex = ThinkTagSplitter(["think"]), StreamingImageExtractor()
        segs = []
        for chunk in (md[:i], md[i:]):
            for kind, text in sp.feed(chunk):
                segs += [("thinking", text)] if kind == "thinking" else ex.feed(text)
        for kind, text in sp.flush():
            segs += [("thinking", text)] if kind == "thinking" else ex.feed(text)
        segs += ex.flush()
        kinds = [s[0] for s in segs if s[0] != "text"]
        assert [k for j, k in enumerate(kinds) if j == 0 or kinds[j - 1] != k] == ["thinking", "image"]
        assert "".join(s[1] for s in segs if s[0] == "thinking") == "hmm"
        assert ("image", "x", "image/png", data) in segs

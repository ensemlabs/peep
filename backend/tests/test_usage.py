import json
import os
import socket
from pathlib import Path

import pytest

from app.services import tokens
from app.services.usage import make_usage, normalize_usage
from tests.conftest import active_client, new_conversation, parse_sse, send_message, serve, sql
from tests.test_providers import FakeOpenAI, chunk
from tests.test_registry import YAML


def test_normalize_openai_shape():
    u = normalize_usage({
        "prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150,
        "prompt_tokens_details": {"cached_tokens": 40}, "completion_tokens_details": {"reasoning_tokens": 20},
    })
    assert u == {
        "input_tokens": 100, "output_tokens": 50, "reasoning_tokens": 20, "cache_read_tokens": 40,
        "cache_write_tokens": None, "total_tokens": 150, "source": "provider",
    }


def test_normalize_deepseek_shape():
    u = normalize_usage({
        "prompt_tokens": 30, "completion_tokens": 5, "prompt_cache_hit_tokens": 25, "prompt_cache_miss_tokens": 5,
        "completion_tokens_details": {"reasoning_tokens": 3},
    })
    assert (u["input_tokens"], u["output_tokens"], u["cache_read_tokens"], u["reasoning_tokens"]) == (30, 5, 25, 3)
    assert u["cache_write_tokens"] is None


def test_normalize_anthropic_style_shape():
    u = normalize_usage({
        "input_tokens": 10, "output_tokens": 4, "cache_read_input_tokens": 7, "cache_creation_input_tokens": 2,
    })
    assert (u["input_tokens"], u["output_tokens"], u["cache_read_tokens"], u["cache_write_tokens"]) == (10, 4, 7, 2)
    assert u["total_tokens"] == 14 and u["reasoning_tokens"] is None


def test_normalize_prefers_openai_cached_tokens_and_rejects_junk():
    u = normalize_usage({
        "prompt_tokens": 9, "completion_tokens": 1, "prompt_tokens_details": {"cached_tokens": 3}, "prompt_cache_hit_tokens": 8,
    })
    assert u["cache_read_tokens"] == 3
    for junk in (None, {}, {"prompt_tokens": "x", "completion_tokens": 1}, {"prompt_tokens": 1}, {"prompt_tokens": -1, "completion_tokens": 1}):
        assert normalize_usage(junk) is None


def test_make_usage_estimate_shape():
    assert make_usage(3, 4, None, None, None, "estimate") == {
        "input_tokens": 3, "output_tokens": 4, "reasoning_tokens": None, "cache_read_tokens": None,
        "cache_write_tokens": None, "total_tokens": 7, "source": "estimate",
    }


def test_count_text():
    assert tokens.count_text("") == 0
    assert tokens.count_text("hello world") == 2
    assert tokens.count_text("hello world", ratio=2.0) == 4
    assert tokens.count_text("<|endoftext|> special text is fine") > 0


def test_tiktoken_works_offline(monkeypatch):
    """The BPE file is baked into the image: encoding must not need the network."""
    cache_dir = os.environ.get("TIKTOKEN_CACHE_DIR")
    assert cache_dir and any(Path(cache_dir).iterdir()), "TIKTOKEN_CACHE_DIR must be populated at build time"

    def no_network(*a, **kw):
        raise OSError("network disabled in test")

    monkeypatch.setattr(socket.socket, "connect", no_network)
    monkeypatch.setattr(socket, "getaddrinfo", no_network)
    tokens._encoding.cache_clear()
    assert tokens.count_text("offline works") >= 2
    tokens._encoding.cache_clear()


def usage_chunk(**usage):
    return {"id": "c", "object": "chat.completion.chunk", "created": 0, "model": "m", "choices": [], "usage": usage}


async def run_with(make_client, use_registry, monkeypatch, script, yaml_text=YAML, model_usage="provider"):
    fake = FakeOpenAI(script=script)
    async with serve(fake.app) as url:
        monkeypatch.setenv("TEST_BASE", url + "/v1")
        use_registry(yaml_text.replace("usage: estimate", f"usage: {model_usage}"))
        c, _ = await active_client(make_client)
        cid = await new_conversation(c)
        r, events = await send_message(c, cid, "hello there", reasoning="high")
        assert r.status_code == 200
        conv = (await c.get(f"/api/conversations/{cid}")).json()
        return c, cid, events, conv["messages"][-1], fake


async def test_provider_usage_event_order_and_persistence(make_client, use_registry, monkeypatch):
    script = [
        chunk(reasoning="hm"), chunk(content="Hi!"),
        usage_chunk(
            prompt_tokens=11, completion_tokens=7, total_tokens=18,
            prompt_tokens_details={"cached_tokens": 4}, completion_tokens_details={"reasoning_tokens": 2},
        ),
    ]
    c, cid, events, msg, fake = await run_with(make_client, use_registry, monkeypatch, script)
    assert fake.requests[0]["stream_options"] == {"include_usage": True}
    names = [e[0] for e in events]
    assert names[-2:] == ["usage", "done"] and names.count("usage") == 1
    ev = events[-2][1]
    assert ev["message_id"] == msg["id"]
    assert ev["usage"] == {
        "input_tokens": 11, "output_tokens": 7, "reasoning_tokens": 2, "cache_read_tokens": 4,
        "cache_write_tokens": None, "total_tokens": 18, "source": "provider",
    }
    assert msg["usage"] == ev["usage"]
    assert (await sql("SELECT usage FROM messages WHERE role = 'assistant'"))[0][0] == ev["usage"]


async def test_deepseek_style_cache_fields_through_the_sdk(make_client, use_registry, monkeypatch):
    script = [chunk(content="x"), usage_chunk(prompt_tokens=20, completion_tokens=3, prompt_cache_hit_tokens=15, prompt_cache_miss_tokens=5)]
    *_, msg, _ = await run_with(make_client, use_registry, monkeypatch, script)
    assert msg["usage"]["cache_read_tokens"] == 15 and msg["usage"]["source"] == "provider"


async def test_estimate_when_provider_sends_no_usage(make_client, use_registry, monkeypatch):
    script = [chunk(content="<think>thinking about it</think>Hello to you")]
    *_, events, msg, _ = await run_with(make_client, use_registry, monkeypatch, script)
    u = msg["usage"]
    assert u["source"] == "estimate" and u["cache_read_tokens"] is None and u["cache_write_tokens"] is None
    assert u["input_tokens"] >= 2 and u["output_tokens"] > u["reasoning_tokens"] > 0
    assert u["total_tokens"] == u["input_tokens"] + u["output_tokens"]
    assert [e[0] for e in events][-2:] == ["usage", "done"]


async def test_estimate_mode_ignores_provider_numbers(make_client, use_registry, monkeypatch):
    script = [chunk(content="Hello"), usage_chunk(prompt_tokens=999, completion_tokens=999)]
    *_, msg, _ = await run_with(make_client, use_registry, monkeypatch, script, model_usage="estimate")
    assert msg["usage"]["source"] == "estimate" and msg["usage"]["input_tokens"] < 50


async def test_token_ratio_scales_estimate(make_client, use_registry, monkeypatch):
    script = [chunk(content="Hello")]
    *_, base, _ = await run_with(make_client, use_registry, monkeypatch, script)
    *_, scaled, _ = await run_with(
        make_client, use_registry, monkeypatch, script, YAML.replace("image_tokens: 100", "image_tokens: 100\n        token_ratio: 3.0")
    )
    assert scaled["usage"]["input_tokens"] >= 2 * base["usage"]["input_tokens"]


async def test_think_tags_become_thinking_part(make_client, use_registry, monkeypatch):
    script = [chunk(content="<thi"), chunk(content="nk>plan it</th"), chunk(content="ink>The answer"), chunk(content=" is 4")]
    *_, msg, _ = await run_with(make_client, use_registry, monkeypatch, script)
    assert [p["type"] for p in msg["parts"]] == ["thinking", "text"]
    assert msg["parts"][0]["text"] == "plan it" and msg["parts"][0]["status"] == "done"
    assert msg["parts"][1]["text"] == "The answer is 4"


async def test_reasoning_field_alias_is_read(make_client, use_registry, monkeypatch):
    script = [{"id": "c", "object": "chat.completion.chunk", "created": 0, "model": "m",
               "choices": [{"index": 0, "delta": {"reasoning": "via alias"}, "finish_reason": None}]}, chunk(content="ok")]
    *_, msg, _ = await run_with(make_client, use_registry, monkeypatch, script)
    assert msg["parts"][0]["type"] == "thinking" and msg["parts"][0]["text"] == "via alias"


async def test_replay_run_has_estimated_usage(make_client):
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    r, events = await send_message(c, cid, "x", model="replay:error-demo")
    names = [e[0] for e in events]
    assert names[-2:] == ["usage", "done"] and events[-2][1]["usage"]["source"] == "estimate"


async def test_estimation_failure_does_not_fail_the_run(make_client, monkeypatch):
    from app.services import runs

    def boom(*a, **k):
        raise RuntimeError("tokenizer exploded")

    monkeypatch.setattr(runs, "estimate_usage", boom)
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    r, events = await send_message(c, cid, "x", model="replay:error-demo")
    msgs = (await c.get(f"/api/conversations/{cid}")).json()["messages"]
    assert [e[0] for e in events][-1] == "done" and "usage" not in [e[0] for e in events]
    assert msgs[1]["usage"] is None and msgs[1]["status"] == "error"  # replay error-demo errors by design
    r, events = await send_message(c, cid, "x", model="replay:agent-demo")
    assert events[-1][1]["status"] == "complete" and "usage" not in [e[0] for e in events]


async def test_estimate_on_partial_error_and_none_when_nothing_arrived(make_client, use_registry, monkeypatch):
    from tests.test_providers import FakeOpenAI

    err = {"error": {"message": "boom", "type": "server_error"}}
    fake = FakeOpenAI(script=[chunk(content="partial answer"), err])
    async with serve(fake.app) as url:
        monkeypatch.setenv("TEST_BASE", url + "/v1")
        use_registry(YAML)
        c, _ = await active_client(make_client)
        cid = await new_conversation(c)
        r, events = await send_message(c, cid, "hello")
        assert [e[0] for e in events][-2:] == ["usage", "done"] and events[-1][1]["status"] == "error"
        assert events[-2][1]["usage"]["source"] == "estimate" and events[-2][1]["usage"]["output_tokens"] > 0
        assert (await sql("SELECT usage FROM messages WHERE role='assistant'"))[0][0]["source"] == "estimate"

        fake.script = [err]  # nothing arrived before the error: no usage
        r, events = await send_message(c, cid, "again")
        assert "usage" not in [e[0] for e in events] and events[-1][1]["status"] == "error"


async def test_stop_emits_estimated_usage_before_done(live_api, settings, monkeypatch):
    from tests.conftest import create_user
    from tests.test_runs import live_login, sse_iter, start_stream

    monkeypatch.setattr(settings, "replay_time_scale", 0.2)
    await create_user("a@example.com")
    c = await live_login(live_api, "a@example.com")
    cid = await new_conversation(c)
    cm, resp = await start_stream(c, cid)
    it = sse_iter(resp)
    asst_id, events = None, []
    async for name, data in it:
        events.append((name, data))
        if name == "message":
            asst_id = data["assistant_message"]["id"]
        if name == "part" and data["part"].get("name") == "read_file":
            break
    await c.post(f"/api/messages/{asst_id}/stop")
    async for name, data in it:
        events.append((name, data))
    await cm.__aexit__(None, None, None)
    assert [e[0] for e in events][-2:] == ["usage", "done"] and events[-1][1]["status"] == "stopped"
    assert events[-2][1]["usage"]["source"] == "estimate" and events[-2][1]["usage"]["output_tokens"] > 0
    row = (await sql("SELECT status, usage FROM messages WHERE role='assistant'"))[0]
    assert row[0] == "stopped" and row[1]["source"] == "estimate"
    await c.aclose()


async def test_extractor_held_text_is_emitted_before_a_thinking_part(make_client, use_registry, monkeypatch):
    script = [chunk(content="see ![alt"), chunk(reasoning="late thought"), chunk(content="done")]
    yaml_text = YAML.replace("delta_fields: [reasoning]", "delta_fields: [reasoning_content]")
    *_, msg, _ = await run_with(make_client, use_registry, monkeypatch, script, yaml_text)
    assert [p["type"] for p in msg["parts"]] == ["text", "thinking", "text"]
    assert msg["parts"][0]["text"] == "see ![alt" and msg["parts"][2]["text"] == "done"


async def test_literal_think_tag_mid_answer_is_text(make_client, use_registry, monkeypatch):
    script = [chunk(content="Example:\n```html\n<think>x</think>\n```")]
    *_, msg, _ = await run_with(make_client, use_registry, monkeypatch, script)
    assert [p["type"] for p in msg["parts"]] == ["text"] and "<think>x</think>" in msg["parts"][0]["text"]

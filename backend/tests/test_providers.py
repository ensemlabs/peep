import base64
import io
import json

import pytest
from PIL import Image
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from app.services import storage
from tests.conftest import active_client, new_conversation, parse_sse, send_message, serve, sql
from tests.test_files import png_bytes, upload


def chunk(content=None, reasoning=None, finish=None):
    delta = {}
    if content is not None:
        delta["content"] = content
    if reasoning is not None:
        delta["reasoning_content"] = reasoning
    return {
        "id": "c1", "object": "chat.completion.chunk", "created": 0, "model": "gemini-pro",
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }


class FakeOpenAI:
    """Tiny OpenAI-compatible server. `script` is a list of dicts (sent as data: lines) or raw strings."""

    def __init__(self, script=None, status=200, error_body=None):
        self.script = script or []
        self.status = status
        self.error_body = error_body
        self.requests: list[dict] = []
        self.app = Starlette(
            routes=[Route("/v1/chat/completions", self.completions, methods=["POST"]), Route("/v1/models", self.models)]
        )

    async def models(self, _):
        return JSONResponse({"object": "list", "data": [{"id": "gemini-pro", "object": "model"}]})

    async def completions(self, request: Request):
        self.requests.append(await request.json())
        if self.status != 200:
            return JSONResponse(self.error_body or {"error": {"message": "nope"}}, status_code=self.status)

        async def gen():
            for item in self.script:
                line = item if isinstance(item, str) else json.dumps(item)
                yield f"data: {line}\n\n".encode()
            yield b"data: [DONE]\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream")


@pytest.fixture
async def fake(settings, monkeypatch):
    async def start(**kw):
        f = FakeOpenAI(**kw)
        cm = serve(f.app)
        url = await cm.__aenter__()
        monkeypatch.setattr(settings, "llm_base_url", url + "/v1")
        f._cm = cm
        started.append(f)
        return f

    started: list[FakeOpenAI] = []
    yield start
    for f in started:
        await f._cm.__aexit__(None, None, None)


async def run_chat(c, fake_server, content="hi", reasoning="off", **extra):
    cid = await new_conversation(c)
    r, events = await send_message(c, cid, content, model="gemini-pro", reasoning=reasoning, **extra)
    assert r.status_code == 200, r.text
    conv = (await c.get(f"/api/conversations/{cid}")).json()
    return cid, events, conv["messages"][-1]


async def test_reasoning_becomes_thinking_then_text(make_client, fake):
    server = await fake(
        script=[
            chunk(reasoning="Let me "), chunk(reasoning="think."),
            {"id": "c1", "object": "chat.completion.chunk", "created": 0, "model": "m", "choices": []},  # usage-style chunk
            chunk(content="Hello "), chunk(content="there!"), chunk(finish="stop"),
        ]
    )
    c, _ = await active_client(make_client)
    _, events, msg = await run_chat(c, server, reasoning="high")
    assert server.requests[0]["reasoning_effort"] == "high" and server.requests[0]["stream"] is True
    assert server.requests[0]["messages"] == [{"role": "user", "content": "hi"}]
    parts = msg["parts"]
    assert [p["type"] for p in parts] == ["thinking", "text"]
    assert parts[0]["text"] == "Let me think." and parts[0]["status"] == "done" and parts[0]["ended_at"]
    assert parts[1]["text"] == "Hello there!"
    assert msg["status"] == "complete" and msg["content"] == "Hello there!" and msg["model"] == "gemini-pro"
    names = [e[0] for e in events]
    assert names[0] == "message" and names[-1] == "done" and events[-1][1]["status"] == "complete"
    # thinking is closed before the first text delta
    update_i = next(i for i, e in enumerate(events) if e[0] == "update" and e[1]["patch"].get("status") == "done")
    first_text_i = next(i for i, e in enumerate(events) if e[0] == "part" and e[1]["part"]["type"] == "text")
    assert update_i < first_text_i


async def test_no_reasoning_effort_when_off(make_client, fake):
    server = await fake(script=[chunk(content="ok")])
    c, _ = await active_client(make_client)
    await run_chat(c, server)
    assert "reasoning_effort" not in server.requests[0]


async def test_data_uri_image_becomes_files_part(make_client, fake):
    img = png_bytes(64, 32)
    md = f"Here:\n\n![apple](data:image/png;base64,{base64.b64encode(img).decode()})\n\nDone."
    pieces = [md[i : i + 50] for i in range(0, len(md), 50)]
    server = await fake(script=[chunk(content=p) for p in pieces])
    c, user = await active_client(make_client)
    cid, events, msg = await run_chat(c, server)
    parts = msg["parts"]
    assert [p["type"] for p in parts] == ["text", "files", "text"]
    assert parts[0]["text"] == "Here:\n\n" and parts[2]["text"] == "\n\nDone."
    meta = parts[1]["files"][0]
    assert meta["kind"] == "image" and (meta["width"], meta["height"]) == (64, 32) and meta["mime"] == "image/png"
    assert "base64" not in json.dumps(msg) and "base64" not in json.dumps(events)
    got = await c.get(meta["url"])
    assert got.content == img
    row = (await sql("SELECT source, message_id, conversation_id FROM files"))[0]
    assert row[0] == "generated" and str(row[1]) == msg["id"] and str(row[2]) == cid
    # generated files are not user attachments
    conv = (await c.get(f"/api/conversations/{cid}")).json()
    assert conv["messages"][0]["attachments"] == []


async def test_malformed_image_does_not_break_run(make_client, fake):
    server = await fake(script=[chunk(content="a ![x](data:image/png;base64,@@@@) b")])
    c, _ = await active_client(make_client)
    _, _, msg = await run_chat(c, server)
    assert msg["status"] == "complete" and msg["parts"][0]["text"] == "a [invalid image] b"


async def test_mid_stream_error_chunk_sets_error_status(make_client, fake):
    server = await fake(
        script=[chunk(reasoning="hmm"), chunk(content="partial"), {"error": {"message": "boom upstream", "type": "server_error"}}]
    )
    c, _ = await active_client(make_client)
    _, events, msg = await run_chat(c, server)
    assert msg["status"] == "error" and "boom upstream" in msg["error"]
    assert msg["parts"][-1]["text"] == "partial"  # what arrived is kept
    assert all(p["status"] == "done" for p in msg["parts"] if p["type"] == "thinking")
    assert events[-1][0] == "done" and events[-1][1]["status"] == "error" and "boom upstream" in events[-1][1]["error"]


async def test_upstream_401_is_error_not_500(make_client, fake):
    server = await fake(status=401, error_body={"error": {"message": "bad key", "type": "invalid_request_error"}})
    c, _ = await active_client(make_client)
    _, events, msg = await run_chat(c, server)
    assert msg["status"] == "error" and "401" in msg["error"] and "bad key" in msg["error"]
    assert events[-1][1]["status"] == "error"


async def test_connection_refused_is_error(make_client, settings, monkeypatch):
    monkeypatch.setattr(settings, "llm_base_url", "http://127.0.0.1:1/v1")
    c, _ = await active_client(make_client)
    _, _, msg = await run_chat(c, None)
    assert msg["status"] == "error" and "reach" in msg["error"]


# --- history ---------------------------------------------------------------------------------


async def test_history_text_only_for_earlier_turns_and_attachments_for_last(make_client, fake):
    server = await fake(script=[chunk(reasoning="secret thoughts"), chunk(content="First answer")])
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    r, _ = await send_message(c, cid, "first question", model="gemini-pro")
    assert r.status_code == 200

    img = png_bytes(32, 32)
    a = (await upload(c, img, "pic.png", "image/png")).json()["file"]
    b = (await upload(c, b"print(1)\n", "x.py", "text/x-python")).json()["file"]
    server.script = [chunk(content="Second")]
    r, _ = await send_message(c, cid, "look at these", model="gemini-pro", attachment_ids=[a["id"], b["id"]])
    assert r.status_code == 200
    msgs = server.requests[1]["messages"]
    assert msgs[0] == {"role": "user", "content": "first question"}
    assert msgs[1] == {"role": "assistant", "content": "First answer"}  # thinking dropped
    last = msgs[2]
    assert last["role"] == "user" and isinstance(last["content"], list)
    assert last["content"][0]["type"] == "text"
    assert "look at these" in last["content"][0]["text"] and "[Attached file: x.py (text/x-python, 9 B)]" in last["content"][0]["text"]
    url = last["content"][1]["image_url"]["url"]
    assert url == "data:image/png;base64," + base64.b64encode(img).decode()
    assert len(msgs) == 3


async def test_history_image_limits(make_client, fake, monkeypatch):
    from app.services import history

    monkeypatch.setattr(history, "MAX_IMAGES", 2)
    server = await fake(script=[chunk(content="ok")])
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    ids = [(await upload(c, png_bytes(8 + i, 8), f"p{i}.png", "image/png")).json()["file"]["id"] for i in range(3)]
    await send_message(c, cid, "x", model="gemini-pro", attachment_ids=ids)
    content = server.requests[0]["messages"][-1]["content"]
    assert [p["type"] for p in content] == ["text", "image_url", "image_url"]
    assert "[Attached file: p2.png" in content[0]["text"]


async def test_history_total_image_bytes_cap(make_client, fake, monkeypatch):
    from app.services import history

    datas = [png_bytes(8, 8 + i) for i in range(3)]
    monkeypatch.setattr(history, "MAX_TOTAL_IMAGE_BYTES", len(datas[0]) + len(datas[1]) + 1)
    server = await fake(script=[chunk(content="ok")])
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    ids = [(await upload(c, d, f"p{i}.png", "image/png")).json()["file"]["id"] for i, d in enumerate(datas)]
    await send_message(c, cid, "x", model="gemini-pro", attachment_ids=ids)
    content = server.requests[0]["messages"][-1]["content"]
    assert [p["type"] for p in content] == ["text", "image_url", "image_url"]
    assert "[Attached file: p2.png" in content[0]["text"]

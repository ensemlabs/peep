import asyncio
import copy
import json
import uuid

import httpx2 as httpx
import pytest

from app.config import get_settings
from app.providers.replay_provider import ASSETS_DIR, FIXTURES_DIR, Fixture, list_fixture_names, load_fixture
from app.services.runs import registry
from tests.conftest import (
    PASSWORD,
    active_client,
    create_user,
    new_conversation,
    parse_sse,
    send_message,
    sql,
)
from tests.test_files import png_bytes, upload


def apply_events(events, message=None):
    """Reference reducer: rebuild the part tree from SSE events (what the FE does)."""
    parts: list = [] if message is None else copy.deepcopy(message["parts"])
    index: dict = {}

    def reg(p):
        index[p["id"]] = p
        for ch in p.get("parts", []):
            reg(ch)

    for p in parts:
        reg(p)
    for name, d in events:
        if name == "part":
            part = copy.deepcopy(d["part"])
            (parts if d["parent_id"] is None else index[d["parent_id"]]["parts"]).append(part)
            reg(part)
        elif name == "delta":
            p = index[d["part_id"]]
            p[d["field"]] = (p.get(d["field"]) or "") + d["text"]
        elif name == "update":
            index[d["part_id"]].update(d["patch"])
    return parts


def strip(parts):
    """Drop volatile timestamps for comparison."""
    out = copy.deepcopy(parts)
    stack = list(out)
    while stack:
        p = stack.pop()
        p.pop("started_at", None)
        p.pop("ended_at", None)
        stack.extend(p.get("parts", []))
    return out


async def conversation_messages(c, cid):
    return (await c.get(f"/api/conversations/{cid}")).json()["messages"]


# --- fixtures --------------------------------------------------------------------------------


def test_fixtures_validate_and_assets_exist():
    assert {"agent-demo", "error-demo"} <= set(list_fixture_names())
    for name in list_fixture_names():
        assert load_fixture(name).steps
    for asset in ("demo.webm", "demo.mp4", "demo.mp3", *[f"gallery-{i}.jpg" for i in range(1, 6)]):
        assert (ASSETS_DIR / asset).is_file()
    total = sum(p.stat().st_size for p in ASSETS_DIR.iterdir() if p.suffix != ".md")
    assert total <= 6 * 1024 * 1024


@pytest.mark.parametrize(
    "bad",
    [
        {"steps": [{"op": "delta", "part_id": "nope", "field": "text", "text": "x"}]},
        {"steps": [{"op": "part", "part": {"id": "a", "type": "weird"}}]},
        {"steps": [{"op": "part", "part": {"id": "a", "type": "text"}, "parent": "ghost"}]},
        {"steps": [{"op": "part", "part": {"id": "a", "type": "tool", "files": ["asset:missing.png"]}}]},
        {"steps": [{"op": "update", "part_id": "a"}]},
        {"steps": [{"op": "part", "part": {"id": "a", "type": "text"}, "after_ms": -5}]},
        {"steps": [], "unknown": 1},
    ],
)
def test_fixture_validation_rejects(bad):
    with pytest.raises(Exception):
        Fixture.model_validate(bad)


def test_agent_demo_fixture_has_expected_shape():
    steps = load_fixture("agent-demo").steps
    total = sum(s.after_ms for s in steps) / 1000
    assert 18 <= total <= 26
    assert steps[0].part["type"] == "thinking"


# --- full replay runs (ASGITransport buffers the stream, time scale 0) -------------------------


async def test_agent_demo_run_builds_expected_tree(make_client):
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    r, events = await send_message(c, cid, "Please speed up is_prime", model="replay:agent-demo")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    names = [e[0] for e in events]
    assert names[0] == "message" and names[-1] == "done"
    assert {"part", "delta", "update"} <= set(names)
    assert events[-1][1] == {"message_id": events[0][1]["assistant_message"]["id"], "status": "complete"}
    first = events[0][1]
    assert first["user_message"]["content"] == "Please speed up is_prime" and first["user_message"]["attachments"] == []
    assert first["assistant_message"]["status"] == "streaming" and first["assistant_message"]["parts"] == []

    msgs = await conversation_messages(c, cid)
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    asst = msgs[1]
    assert asst["status"] == "complete" and asst["model"] == "replay:agent-demo" and asst["error"] is None
    parts = asst["parts"]
    top = [(p["type"], p.get("name")) for p in parts]
    assert top == [
        ("thinking", None), ("text", None), ("tool", "read_file"), ("subagent", "art-director"),
        ("tool", "generate_images"), ("tool", "make_clip"), ("tool", "make_chime"), ("text", None),
    ]
    assert parts[0]["status"] == "done" and parts[0]["text"] and parts[0]["ended_at"]
    read = parts[2]
    assert read["input"] == {"path": "brand/peep.md"} and "Peep" in read["output"] and "#FFD54A" in read["output"]
    assert read["status"] == "done"

    director = parts[3]
    assert [(p["type"], p.get("name")) for p in director["parts"]] == [
        ("tool", "web_search"), ("subagent", "copywriter"), ("text", None),
    ]
    search = director["parts"][0]
    assert search["input"] == {"query": "cozy 3D mascot photography soft light"} and len(json.loads(search["output"])) == 3
    copywriter = director["parts"][1]  # sub-agent inside a sub-agent: two levels deep
    assert [p["type"] for p in copywriter["parts"]] == ["text"] and "See everything your agent does" in copywriter["parts"][0]["text"]
    assert director["status"] == copywriter["status"] == "done"

    images = parts[4]
    assert images["input"]["count"] == 5 and len(images["input"]["prompts"]) == 5 and images["input"]["model"] == "gemini"
    gallery = images["files"]
    assert len(gallery) == 5 and all(f["kind"] == "image" and f["thumb_url"] and f["width"] == 1600 for f in gallery)
    assert [f["mime"] for f in gallery] == ["image/jpeg"] * 5
    assert parts[5]["input"] == {"source": "generated images", "count": 5, "seconds": 8, "style": "slow zoom with crossfades"}
    assert parts[5]["output"] == "Assembling the clip...\nBuilt an 8-second clip from the generated images."
    assert [f["kind"] for f in parts[5]["files"]] == ["video", "video"]
    assert [f["mime"] for f in parts[5]["files"]] == ["video/webm", "video/mp4"]
    assert [(f["kind"], f["mime"]) for f in parts[6]["files"]] == [("audio", "audio/mpeg")]
    final = parts[7]["text"]
    assert "```html" in final and "| Asset | File | Use |" in final and "AI-generated" in final
    assert "assembled from" in final and "rendered with Gemini" not in final
    assert final.startswith("Here are 5 images of the chick mascot and a short clip made from them.")
    assert "launch" not in json.dumps(parts).lower() and "kit" not in json.dumps(parts).lower()
    assert asst["content"].endswith(final)

    # every stored file is served to the owner, with working ranges
    webm = parts[5]["files"][0]
    r = await c.get(webm["url"], headers={"Range": "bytes=0-1"})
    assert r.status_code == 206 and r.content == (ASSETS_DIR / "demo.webm").read_bytes()[:2]
    r = await c.get(gallery[0]["thumb_url"])
    assert r.status_code == 200

    # reducer over the SSE stream == persisted tree
    assert strip(apply_events(events)) == strip(parts)
    assert (await sql("SELECT count(*) FROM files WHERE source = 'generated'"))[0][0] == 5 + 2 + 1


async def test_error_demo_ends_in_error(make_client):
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    r, events = await send_message(c, cid, "deploy", model="replay:error-demo")
    assert events[-1][0] == "done" and events[-1][1]["status"] == "error" and "connection refused" in events[-1][1]["error"]
    asst = (await conversation_messages(c, cid))[1]
    assert asst["status"] == "error" and "connection refused" in asst["error"]
    assert [p["type"] for p in asst["parts"]] == ["text", "tool"]
    assert asst["parts"][1]["status"] == "error" and "Error: connection refused" in asst["parts"][1]["output"]


async def test_message_validation_and_titles(make_client):
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    r, _ = await send_message(c, cid, "   ", model="replay:error-demo")
    assert r.status_code == 422 and r.json()["error"]["code"] == "empty_message"
    r, _ = await send_message(c, cid, "x", model="gemini-pro", reasoning="medium")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_reasoning_level"
    r, _ = await send_message(c, cid, "x", model="replay:error-demo", attachment_ids=[str(uuid.uuid4())])
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_attachment"
    assert (await sql("SELECT count(*) FROM messages"))[0][0] == 0

    long = "  first   line\n\nwith   spaces " + "z" * 100
    r, _ = await send_message(c, cid, long, model="replay:error-demo")
    assert r.status_code == 200
    title = (await c.get("/api/conversations")).json()["items"][0]["title"]
    assert title == ("first line with spaces " + "z" * 100)[:60] and len(title) == 60
    await registry.wait_idle()
    await send_message(c, cid, "second", model="replay:error-demo")
    assert (await c.get("/api/conversations")).json()["items"][0]["title"] == title  # only the first message names it


async def test_attachments_are_attached_and_exposed(make_client):
    c, _ = await active_client(make_client)
    other, _ = await active_client(make_client)
    cid = await new_conversation(c)
    img = (await upload(c, png_bytes(), "p.png", "image/png")).json()["file"]
    foreign = (await upload(other, png_bytes(), "q.png", "image/png")).json()["file"]
    r, _ = await send_message(c, cid, "x", model="replay:error-demo", attachment_ids=[foreign["id"]])
    assert r.status_code == 422  # someone else's file
    r, events = await send_message(c, cid, "", model="replay:error-demo", attachment_ids=[img["id"], img["id"]])
    assert r.status_code == 200
    assert events[0][1]["user_message"]["attachments"] == [img]
    msgs = await conversation_messages(c, cid)
    assert msgs[0]["attachments"] == [img] and msgs[1]["attachments"] == []
    assert (await c.get("/api/conversations")).json()["items"][0]["title"] == "p.png"
    await registry.wait_idle()
    r, _ = await send_message(c, cid, "again", model="replay:error-demo", attachment_ids=[img["id"]])
    assert r.status_code == 422  # already attached to a message


async def test_conversation_model_default_and_updates(make_client):
    c, _ = await active_client(make_client)
    cid = await new_conversation(c, model="replay:error-demo")
    r = await c.post(f"/api/conversations/{cid}/messages", json={"content": "hi"})
    assert r.status_code == 200 and parse_sse(r.text)[0][1]["assistant_message"]["model"] == "replay:error-demo"


# --- real streaming (live socket) ----------------------------------------------------------------


async def live_login(url, email):
    origin = sorted(get_settings().origins)[0]
    c = httpx.AsyncClient(base_url=url, headers={"Origin": origin}, timeout=30)
    r = await c.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200
    return c


async def sse_iter(resp):
    name = None
    data = []
    async for line in resp.aiter_lines():
        if line.startswith("event:"):
            name = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip())
        elif line == "" and name:
            yield name, json.loads("\n".join(data))
            name, data = None, []


async def start_stream(c, cid, model="replay:agent-demo", **extra):
    cm = c.stream("POST", f"/api/conversations/{cid}/messages", json={"content": "go", "model": model, **extra})
    resp = await cm.__aenter__()
    assert resp.status_code == 200, await resp.aread()
    return cm, resp


async def test_client_disconnect_does_not_cancel_run(live_api, settings, monkeypatch):
    monkeypatch.setattr(settings, "replay_time_scale", 0.03)
    await create_user("a@example.com")
    c = await live_login(live_api, "a@example.com")
    cid = await new_conversation(c)
    cm, resp = await start_stream(c, cid)
    it = sse_iter(resp)
    assert (await anext(it))[0] == "message"
    await anext(it)
    await cm.__aexit__(None, None, None)  # disconnect mid-run
    await resp.aclose()
    await asyncio.sleep(0.2)
    assert registry.is_busy(uuid.UUID(cid))  # still running without any subscriber
    await registry.wait_idle()
    asst = (await conversation_messages(c, cid))[1]
    assert asst["status"] == "complete" and asst["parts"][-1]["type"] == "text" and len(asst["parts"]) == 8
    await c.aclose()


async def test_concurrent_send_is_409(live_api, settings, monkeypatch):
    monkeypatch.setattr(settings, "replay_time_scale", 0.05)
    await create_user("a@example.com")
    c = await live_login(live_api, "a@example.com")
    cid = await new_conversation(c)
    cm, resp = await start_stream(c, cid)
    r = await c.post(f"/api/conversations/{cid}/messages", json={"content": "again", "model": "replay:agent-demo"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "run_in_progress"
    assert (await c.delete(f"/api/conversations/{cid}")).status_code == 409
    other = await new_conversation(c)  # other conversations are unaffected
    r = await c.post(f"/api/conversations/{other}/messages", json={"content": "x", "model": "replay:error-demo"})
    assert r.status_code == 200
    await resp.aread()
    await cm.__aexit__(None, None, None)
    await registry.wait_idle()
    # after completion a new message is accepted
    r = await c.post(f"/api/conversations/{cid}/messages", json={"content": "again", "model": "replay:error-demo"})
    assert r.status_code == 200
    await c.aclose()


async def test_stop_marks_stopped_and_keeps_partial_parts(live_api, settings, monkeypatch):
    monkeypatch.setattr(settings, "replay_time_scale", 0.2)
    await create_user("a@example.com")
    c = await live_login(live_api, "a@example.com")
    cid = await new_conversation(c)
    cm, resp = await start_stream(c, cid)
    events = []
    asst_id = None
    it = sse_iter(resp)
    async for name, data in it:
        events.append((name, data))
        if name == "message":
            asst_id = data["assistant_message"]["id"]
        if name == "part" and data["part"].get("name") == "read_file":
            break
    r = await c.post(f"/api/messages/{asst_id}/stop")
    assert r.status_code == 202
    async for name, data in it:
        events.append((name, data))
    await cm.__aexit__(None, None, None)
    assert events[-1] == ("done", {"message_id": asst_id, "status": "stopped"})
    asst = (await conversation_messages(c, cid))[1]
    assert asst["status"] == "stopped" and asst["error"] is None
    types = [p.get("name") or p["type"] for p in asst["parts"]]
    assert types[:3] == ["thinking", "text", "read_file"] and len(types) < 8
    assert asst["parts"][0]["status"] == "done"
    assert asst["parts"][-1]["status"] in ("done", "error")  # nothing left "running"
    assert not [p for p in asst["parts"] if p.get("status") == "running"]
    assert strip(apply_events(events)) == strip(asst["parts"])
    assert not registry.is_busy(uuid.UUID(cid))
    # stop on a finished message is harmless
    assert (await c.post(f"/api/messages/{asst_id}/stop")).status_code == 202
    other, _ = await active_client_live(live_api)
    assert (await other.post(f"/api/messages/{asst_id}/stop")).status_code == 404
    await other.aclose()
    await c.aclose()


async def active_client_live(url):
    email = f"u-{uuid.uuid4().hex[:6]}@example.com"
    await create_user(email)
    return await live_login(url, email), email


async def test_reconnect_events_snapshot_then_rest(live_api, settings, monkeypatch):
    monkeypatch.setattr(settings, "replay_time_scale", 0.1)
    await create_user("a@example.com")
    c = await live_login(live_api, "a@example.com")
    cid = await new_conversation(c)
    cm, resp = await start_stream(c, cid)
    it = sse_iter(resp)
    _, first = await anext(it)
    asst_id = first["assistant_message"]["id"]
    seen = 0
    async for name, _ in it:
        seen += 1
        if name == "part" and seen > 20:
            break
    await cm.__aexit__(None, None, None)

    async with c.stream("GET", f"/api/messages/{asst_id}/events") as r2:
        assert r2.status_code == 200
        events = [e async for e in sse_iter(r2)]
    assert events[0][0] == "snapshot"
    snap = events[0][1]["message"]
    assert snap["id"] == asst_id and snap["status"] == "streaming" and snap["parts"]
    assert events[-1] == ("done", {"message_id": asst_id, "status": "complete"})
    assert all(e[0] != "snapshot" for e in events[1:])
    await registry.wait_idle()
    final = (await conversation_messages(c, cid))[1]
    assert strip(apply_events(events[1:], snap)) == strip(final["parts"])

    # after the run: snapshot from the DB, then done
    async with c.stream("GET", f"/api/messages/{asst_id}/events") as r3:
        later = [e async for e in sse_iter(r3)]
    assert [e[0] for e in later] == ["snapshot", "done"]
    assert later[0][1]["message"] == final and later[1][1]["status"] == "complete"

    other, _ = await active_client_live(live_api)
    assert (await other.get(f"/api/messages/{asst_id}/events")).status_code == 404
    assert (await c.get(f"/api/messages/{uuid.uuid4()}/events")).status_code == 404
    await other.aclose()
    await c.aclose()


async def test_parts_flushed_to_db_during_run(live_api, settings, monkeypatch):
    monkeypatch.setattr(settings, "replay_time_scale", 0.2)
    await create_user("a@example.com")
    c = await live_login(live_api, "a@example.com")
    cid = await new_conversation(c)
    cm, resp = await start_stream(c, cid)
    async for name, data in sse_iter(resp):
        if name == "part" and data["part"].get("name") == "art-director":
            break
    row = (await sql("SELECT status, parts FROM messages WHERE role = 'assistant'"))[0]
    assert row[0] == "streaming" and [p["type"] for p in row[1]][:3] == ["thinking", "text", "tool"]
    await cm.__aexit__(None, None, None)
    await registry.wait_idle()
    await c.aclose()


async def test_interrupted_runs_are_marked_on_startup():
    # covered in test_platform::test_streaming_messages_marked_interrupted; here: no registry leftovers
    assert not registry._runs and not registry._busy


async def test_limited_user_has_single_active_run(live_api, settings, monkeypatch):
    monkeypatch.setattr(settings, "replay_time_scale", 0.05)
    limited = await create_user("lim@example.com")
    await create_user("free@example.com")
    await sql("UPDATE users SET token_limit = 1000000 WHERE id = :i", i=limited.id)
    for email, second_status in (("lim@example.com", 409), ("free@example.com", 200)):
        c = await live_login(live_api, email)
        c1, c2 = await new_conversation(c), await new_conversation(c)
        cm, resp = await start_stream(c, c1)
        r = await c.post(f"/api/conversations/{c2}/messages", json={"content": "x", "model": "replay:error-demo"})
        assert r.status_code == second_status, r.text
        if second_status == 409:
            assert r.json()["error"] == {"code": "run_in_progress", "message": "Another reply is still being generated"}
        await resp.aread()
        await cm.__aexit__(None, None, None)
        await registry.wait_idle()
        # the slot is released when the run ends
        r = await c.post(f"/api/conversations/{c2}/messages", json={"content": "y", "model": "replay:error-demo"})
        assert r.status_code == 200
        await registry.wait_idle()
        await c.aclose()

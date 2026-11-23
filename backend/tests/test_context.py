import json

from app.services import tokens
from tests.conftest import active_client, new_conversation, send_message, sql
from tests.test_files import png_bytes, upload
from tests.test_registry import YAML

KEYS = ["system", "user_messages", "assistant_messages", "attachments", "tool_results", "skills"]


async def test_empty_new_chat(make_client, use_registry):
    use_registry(YAML)
    c, _ = await active_client(make_client)
    r = await c.get("/api/context")
    assert r.status_code == 200
    body = r.json()
    assert body["model_id"] == "m1" and body["context_window"] == 5000 and body["used_tokens"] == 0
    assert body["free_tokens"] == 5000 and body["estimated"] is True
    assert [b["key"] for b in body["breakdown"]] == KEYS and all(b["tokens"] == 0 for b in body["breakdown"])
    assert body["last_usage"] is None
    assert body["totals"] == {"input_tokens": 0, "output_tokens": 0, "cache_read_tokens": None, "cache_write_tokens": None, "messages": 0}


async def test_breakdown_on_fixture_conversation_with_attachments(make_client, use_registry, settings, monkeypatch):
    use_registry(YAML.replace("active: m1", "dev:\n  model_switcher: true\nactive: m1"))
    c, _ = await active_client(make_client)
    cid = await new_conversation(c, model="replay:error-demo")
    user_text = "please deploy the build to staging"
    r, events = await send_message(c, cid, user_text, model="replay:error-demo")
    asst = (await c.get(f"/api/conversations/{cid}")).json()["messages"][1]
    assert asst["content"].startswith("Deploying the build")

    body = (await c.get("/api/context", params={"conversation_id": cid})).json()
    by = {b["key"]: b for b in body["breakdown"]}
    assert by["user_messages"]["tokens"] == tokens.count_text(user_text)
    assert by["assistant_messages"]["tokens"] == tokens.count_text(asst["content"])
    assert by["attachments"]["tokens"] == 0 and by["system"]["tokens"] == by["tool_results"]["tokens"] == by["skills"]["tokens"] == 0
    base_used = body["used_tokens"]
    assert base_used == by["user_messages"]["tokens"] + by["assistant_messages"]["tokens"]
    assert body["model_id"] == "replay:error-demo" and body["context_window"] == 128000
    assert body["last_usage"]["source"] == "estimate" and body["totals"]["messages"] == 1
    assert body["totals"]["output_tokens"] == body["last_usage"]["output_tokens"]

    # a pending (unsent) image + text file are the draft attachments of the next message
    await upload(c, png_bytes(), "pic.png", "image/png", conversation_id=cid)
    await upload(c, b"print(1)\n", "x.py", "text/x-python", conversation_id=cid)
    body2 = (await c.get("/api/context", params={"conversation_id": cid})).json()
    att = {b["key"]: b for b in body2["breakdown"]}["attachments"]
    line = "[Attached file: x.py (text/x-python, 9 B)]"
    assert att["items"] == [{"name": "pic.png", "tokens": 765}, {"name": line, "tokens": tokens.count_text(line)}]
    assert att["tokens"] == 765 + tokens.count_text(line)
    assert body2["used_tokens"] == base_used + att["tokens"]


async def test_image_tokens_and_ratio_from_model_config(make_client, use_registry):
    use_registry(YAML.replace("token_ratio: 1.0", "").replace("image_tokens: 100", "image_tokens: 100\n        token_ratio: 2.0"))
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    await upload(c, png_bytes(), "pic.png", "image/png", conversation_id=cid)
    await upload(c, png_bytes(8, 8), "b.png", "image/png", conversation_id=cid)
    att = {b["key"]: b for b in (await c.get("/api/context", params={"conversation_id": cid})).json()["breakdown"]}["attachments"]
    assert att["tokens"] == 200 and [i["tokens"] for i in att["items"]] == [100, 100]  # image_tokens each (ratio only scales text)


async def test_provider_usage_gives_real_used_tokens(make_client, use_registry):
    use_registry(YAML.replace("active: m1", "active: replay:error-demo"))
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    await send_message(c, cid, "hello")
    await sql(
        "UPDATE messages SET usage = CAST(:u AS jsonb) WHERE role = 'assistant'",
        u=json.dumps({"input_tokens": 100, "output_tokens": 50, "reasoning_tokens": 10, "cache_read_tokens": 30,
                      "cache_write_tokens": 5, "total_tokens": 150, "source": "provider"}),
    )
    body = (await c.get("/api/context", params={"conversation_id": cid})).json()
    assert body["estimated"] is False and body["used_tokens"] == 140  # reasoning tokens are not resent
    assert body["last_usage"]["cache_read_tokens"] == 30
    assert body["totals"] == {"input_tokens": 100, "output_tokens": 50, "cache_read_tokens": 30, "cache_write_tokens": 5, "messages": 1}


async def test_context_ownership_and_validation(make_client):
    import uuid

    a, _ = await active_client(make_client)
    b, _ = await active_client(make_client)
    cid = await new_conversation(a)
    assert (await b.get("/api/context", params={"conversation_id": cid})).status_code == 404
    assert (await a.get("/api/context", params={"conversation_id": str(uuid.uuid4())})).status_code == 404
    assert (await a.get("/api/context", params={"conversation_id": "x"})).status_code == 422
    assert (await make_client().get("/api/context")).status_code == 401


async def test_context_pending_user_403(make_client):
    from tests.conftest import create_user, login

    await create_user("p@example.com", status="pending")
    c = make_client()
    await login(c, "p@example.com")
    assert (await c.get("/api/context")).status_code == 403


async def test_totals_cache_fields_null_unless_reported(make_client, use_registry):
    use_registry(YAML.replace("active: m1", "active: replay:error-demo"))
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    await send_message(c, cid, "one")
    await send_message(c, cid, "two")
    totals = (await c.get("/api/context", params={"conversation_id": cid})).json()["totals"]
    assert totals["messages"] == 2 and totals["cache_read_tokens"] is None and totals["cache_write_tokens"] is None
    # only one of the two messages reports cache reads: sum the non-null values, write stays null
    await sql(
        "UPDATE messages SET usage = jsonb_set(usage, '{cache_read_tokens}', '7') WHERE id = "
        "(SELECT id FROM messages WHERE role = 'assistant' ORDER BY created_at LIMIT 1)"
    )
    totals = (await c.get("/api/context", params={"conversation_id": cid})).json()["totals"]
    assert totals["cache_read_tokens"] == 7 and totals["cache_write_tokens"] is None


async def test_stale_provider_usage_ignored_after_failed_turn(make_client, use_registry):
    use_registry(YAML.replace("active: m1", "active: replay:error-demo"))
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    await send_message(c, cid, "first")
    await sql("UPDATE messages SET usage = CAST(:u AS jsonb) WHERE role = 'assistant'", u=json.dumps(
        {"input_tokens": 9000, "output_tokens": 9000, "reasoning_tokens": None, "cache_read_tokens": None,
         "cache_write_tokens": None, "total_tokens": 18000, "source": "provider"}))
    assert (await c.get("/api/context", params={"conversation_id": cid})).json()["used_tokens"] == 18000
    await send_message(c, cid, "second")  # new reply has estimate usage
    await sql("UPDATE messages SET usage = NULL WHERE id = (SELECT id FROM messages WHERE role='assistant' ORDER BY created_at DESC LIMIT 1)")
    body = (await c.get("/api/context", params={"conversation_id": cid})).json()
    assert body["estimated"] is True and body["used_tokens"] < 1000  # the old provider number is not reused


async def test_tokenising_runs_off_the_event_loop(make_client, monkeypatch):
    import threading

    from app.routers import context

    seen = []
    real = context._context_numbers

    def spy(*a, **k):
        seen.append(threading.current_thread() is threading.main_thread())
        return real(*a, **k)

    monkeypatch.setattr(context, "_context_numbers", spy)
    c, _ = await active_client(make_client)
    assert (await c.get("/api/context")).status_code == 200
    assert seen == [False]

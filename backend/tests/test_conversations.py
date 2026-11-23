import uuid

import pytest
from app.services import storage
from tests.conftest import (
    active_client,
    create_user,
    login,
    new_conversation,
    send_message,
    sql,
)
from tests.test_files import png_bytes, upload


async def test_conversation_crud(make_client):
    c, user = await active_client(make_client)
    assert (await c.get("/api/conversations")).json() == {"items": [], "next_before": None}
    r = await c.post("/api/conversations", json={"title": "  Hello  ", "model": "replay:agent-demo"})
    assert r.status_code == 201
    conv = r.json()["conversation"]
    assert set(conv) == {"id", "title", "model", "created_at", "updated_at", "pinned"}
    assert conv["title"] == "Hello" and conv["model"] == "replay:agent-demo"
    cid = conv["id"]

    r = await c.get(f"/api/conversations/{cid}")
    assert r.json() == {"conversation": conv, "messages": []}

    r = await c.patch(f"/api/conversations/{cid}", json={"title": "  Renamed "})
    assert r.json()["conversation"]["title"] == "Renamed"
    assert (await c.patch(f"/api/conversations/{cid}", json={"title": "   "})).status_code == 422
    assert (await c.patch(f"/api/conversations/{cid}", json={})).status_code == 422

    items = (await c.get("/api/conversations")).json()["items"]
    assert items == [
        {
            "id": cid, "title": "Renamed", "model": "replay:agent-demo", "updated_at": items[0]["updated_at"],
            "status": "idle", "unread": False, "preview": "", "pinned": False,
        }
    ]

    assert (await c.delete(f"/api/conversations/{cid}")).status_code == 204
    assert (await c.get(f"/api/conversations/{cid}")).status_code == 404
    assert (await c.delete(f"/api/conversations/{cid}")).status_code == 404


async def test_list_order_and_paging(make_client):
    c, _ = await active_client(make_client)
    ids = [await new_conversation(c) for _ in range(3)]
    for i, cid in enumerate(ids):
        await sql(f"UPDATE conversations SET updated_at = now() - interval '{10 - i} minutes' WHERE id = :i", i=uuid.UUID(cid))
    items = (await c.get("/api/conversations")).json()["items"]
    assert [x["id"] for x in items] == ids[::-1]
    page = (await c.get("/api/conversations", params={"limit": 2})).json()["items"]
    assert len(page) == 2
    older = (await c.get("/api/conversations", params={"before": page[-1]["updated_at"]})).json()["items"]
    assert [x["id"] for x in older] == [ids[0]]
    assert (await c.get("/api/conversations", params={"limit": 101})).status_code == 422
    assert (await c.get("/api/conversations", params={"before": "yesterday"})).status_code == 422


async def test_ownership(make_client):
    a, _ = await active_client(make_client)
    b, _ = await active_client(make_client)
    cid = await new_conversation(a)
    assert (await b.get("/api/conversations")).json()["items"] == []
    for resp in (
        await b.get(f"/api/conversations/{cid}"),
        await b.patch(f"/api/conversations/{cid}", json={"title": "x"}),
        await b.delete(f"/api/conversations/{cid}"),
        await b.post(f"/api/conversations/{cid}/messages", json={"content": "hi", "model": "replay:agent-demo"}),
    ):
        assert resp.status_code == 404 and resp.json()["error"]["code"] == "not_found"
    assert (await a.get(f"/api/conversations/{cid}")).status_code == 200


async def test_pending_user_403_on_all_new_routes(make_client):
    await create_user("p@example.com", status="pending")
    c = make_client()
    await login(c, "p@example.com")
    u = str(uuid.uuid4())
    calls = [
        c.get("/api/models"),
        c.get("/api/conversations"),
        c.post("/api/conversations", json={}),
        c.get(f"/api/conversations/{u}"),
        c.patch(f"/api/conversations/{u}", json={"title": "x"}),
        c.delete(f"/api/conversations/{u}"),
        c.post(f"/api/conversations/{u}/messages", json={"content": "x"}),
        c.get(f"/api/messages/{u}/events"),
        c.post(f"/api/messages/{u}/stop"),
        c.post("/api/files", files={"file": ("a.txt", b"x")}),
        c.get(f"/api/files/{u}/content"),
        c.get(f"/api/files/{u}/thumb"),
    ]
    for coro in calls:
        r = await coro
        assert r.status_code == 403 and r.json()["error"]["code"] == "account_pending"


async def test_unauthenticated_401(client):
    for r in (await client.get("/api/conversations"), await client.get("/api/models")):
        assert r.status_code == 401


async def test_invalid_model_rejected(make_client):
    c, _ = await active_client(make_client)
    r = await c.post("/api/conversations", json={"model": "nope"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_model"
    cid = await new_conversation(c)
    r, _ = await send_message(c, cid, model="nope")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_model"
    assert (await sql("SELECT count(*) FROM messages"))[0][0] == 0


# --- object cleanup --------------------------------------------------------------------------


async def test_conversation_delete_removes_files_and_objects(make_client):
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    other = await new_conversation(c)
    meta = (await upload(c, png_bytes(), "p.png", "image/png", conversation_id=cid)).json()["file"]
    keep = (await upload(c, png_bytes(), "keep.png", "image/png", conversation_id=other)).json()["file"]
    rows = await sql("SELECT object_key, thumb_key FROM files WHERE id = :i", i=uuid.UUID(meta["id"]))
    obj, thumb = rows[0]
    assert await storage.head(obj) and await storage.head(thumb)
    assert (await c.delete(f"/api/conversations/{cid}")).status_code == 204
    assert await storage.head(obj) is None and await storage.head(thumb) is None
    assert [str(r[0]) for r in await sql("SELECT id FROM files")] == [keep["id"]]


async def test_admin_delete_user_removes_objects(make_client):
    admin = await create_user("admin@example.com", role="admin")
    ac = make_client()
    await login(ac, "admin@example.com")
    uc, user = await active_client(make_client)
    meta = (await upload(uc, png_bytes(), "p.png", "image/png")).json()["file"]
    obj, thumb = (await sql("SELECT object_key, thumb_key FROM files"))[0]
    assert await storage.head(obj)
    assert (await ac.delete(f"/api/admin/users/{user.id}")).status_code == 204
    assert await storage.head(obj) is None and await storage.head(thumb) is None
    assert (await sql("SELECT count(*) FROM files"))[0][0] == 0
    assert meta

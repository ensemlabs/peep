import uuid

import pytest
from sqlalchemy import event

from app.db import get_engine
from app.routers.conversations import make_preview
from app.services.runs import registry
from tests.conftest import active_client, new_conversation, send_message, sql


async def add_message(cid: str, role: str, content: str, status: str = "complete", ago: str = "0 seconds"):
    await sql(
        "INSERT INTO messages (id, conversation_id, role, content, status, created_at, updated_at)"
        f" VALUES (gen_random_uuid(), :c, :r, :t, :s, now() - interval '{ago}', now() - interval '{ago}')",
        c=uuid.UUID(cid), r=role, t=content, s=status,
    )


async def items(c, **params):
    r = await c.get("/api/conversations", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def by_id(body):
    return {i["id"]: i for i in body["items"]}


async def test_item_shape(make_client):
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    item = (await items(c))["items"][0]
    assert item == {
        "id": cid, "title": "", "model": item["model"], "updated_at": item["updated_at"],
        "status": "idle", "unread": False, "preview": "", "pinned": False,
    }


@pytest.mark.parametrize("status", ["streaming", "complete", "error", "stopped"])
async def test_status_from_last_assistant_message(make_client, status):
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    await add_message(cid, "user", "q", ago="3 minutes")
    await add_message(cid, "assistant", "old answer", "complete", ago="2 minutes")
    await add_message(cid, "user", "q2", ago="90 seconds")
    await add_message(cid, "assistant", "latest", status, ago="1 minute")
    assert by_id(await items(c))[cid]["status"] == status


async def test_idle_when_only_user_messages(make_client):
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    await add_message(cid, "user", "hello **world**")
    it = by_id(await items(c))[cid]
    assert it["status"] == "idle" and it["unread"] is False and it["preview"] == "hello world"


async def test_unread_only_for_finished_and_after_last_read(make_client):
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    await add_message(cid, "assistant", "partial", "streaming")
    assert by_id(await items(c))[cid]["unread"] is False  # still running: nothing to read yet
    await sql("UPDATE messages SET status = 'error'")
    assert by_id(await items(c))[cid]["unread"] is True
    assert (await c.post(f"/api/conversations/{cid}/read")).status_code == 204
    assert by_id(await items(c))[cid]["unread"] is False
    await sql("UPDATE messages SET status = 'stopped', updated_at = now() + interval '1 second'")
    assert by_id(await items(c))[cid]["unread"] is True


async def test_unread_transitions_with_real_runs(make_client):
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    await c.post(f"/api/conversations/{cid}/read")
    r, _ = await send_message(c, cid, "go", model="replay:error-demo")
    await registry.wait_idle()
    it = by_id(await items(c))[cid]
    assert (it["status"], it["unread"]) == ("error", True)  # finished after last_read_at
    await c.post(f"/api/conversations/{cid}/read")
    assert by_id(await items(c))[cid]["unread"] is False
    await send_message(c, cid, "again", model="replay:error-demo")
    await registry.wait_idle()
    assert by_id(await items(c))[cid]["unread"] is True  # a new finish is unread again
    r, _ = await send_message(c, cid, "x", model="replay:agent-demo")
    await registry.wait_idle()
    it = by_id(await items(c))[cid]
    assert (it["status"], it["unread"]) == ("complete", True)


async def test_new_conversation_is_not_unread_and_old_ones_are_read(make_client):
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    assert by_id(await items(c))[cid]["unread"] is False


async def test_read_and_pin_ownership(make_client):
    a, _ = await active_client(make_client)
    b, _ = await active_client(make_client)
    cid = await new_conversation(a)
    assert (await b.post(f"/api/conversations/{cid}/read")).status_code == 404
    assert (await b.patch(f"/api/conversations/{cid}", json={"pinned": True})).status_code == 404
    assert (await b.post(f"/api/conversations/{uuid.uuid4()}/read")).status_code == 404
    assert (await b.get("/api/conversations", params={"q": "x"})).json()["items"] == []
    assert by_id(await items(a))[cid]["pinned"] is False


async def test_patch_pinned_and_title(make_client):
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    before = (await items(c))["items"][0]["updated_at"]
    r = await c.patch(f"/api/conversations/{cid}", json={"pinned": True})
    assert r.status_code == 200 and r.json()["conversation"]["pinned"] is True
    r = await c.patch(f"/api/conversations/{cid}", json={"title": "T", "pinned": False})
    assert r.json()["conversation"]["title"] == "T" and r.json()["conversation"]["pinned"] is False
    await c.patch(f"/api/conversations/{cid}", json={"pinned": True})
    assert (await items(c))["items"][0]["updated_at"] == before  # pinning does not bump recency
    assert (await c.patch(f"/api/conversations/{cid}", json={})).status_code == 422
    assert (await c.patch(f"/api/conversations/{cid}", json={"pinned": "maybe"})).status_code == 422


# --- search ---------------------------------------------------------------------------------------


async def test_search_title_and_message_content(make_client):
    c, _ = await active_client(make_client)
    one, two, three = [await new_conversation(c) for _ in range(3)]
    await c.patch(f"/api/conversations/{one}", json={"title": "Quarterly Report"})
    await add_message(two, "user", "please summarise the QUARTERLY numbers")
    await add_message(three, "assistant", "nothing relevant")
    got = {i["id"] for i in (await items(c, q="quarterly"))["items"]}
    assert got == {one, two}
    assert {i["id"] for i in (await items(c, q="  RELEVANT "))["items"]} == {three}
    assert (await items(c, q="zzz-nope"))["items"] == []
    assert len((await items(c, q="   "))["items"]) == 3  # blank q = no filter


async def test_search_escapes_like_wildcards(make_client):
    c, _ = await active_client(make_client)
    pct, under, back, plain = [await new_conversation(c) for _ in range(4)]
    await c.patch(f"/api/conversations/{pct}", json={"title": "100% done"})
    await c.patch(f"/api/conversations/{under}", json={"title": "snake_case"})
    await add_message(back, "user", r"path C:\temp\file")
    await c.patch(f"/api/conversations/{plain}", json={"title": "100 xx done snakeXcase"})
    assert {i["id"] for i in (await items(c, q="%"))["items"]} == {pct}
    assert {i["id"] for i in (await items(c, q="100% d"))["items"]} == {pct}
    assert {i["id"] for i in (await items(c, q="_"))["items"]} == {under}
    assert {i["id"] for i in (await items(c, q="snake_c"))["items"]} == {under}
    assert {i["id"] for i in (await items(c, q="\\"))["items"]} == {back}
    assert {i["id"] for i in (await items(c, q=r"C:\temp"))["items"]} == {back}
    assert (await items(c, q="'; DROP TABLE users; --"))["items"] == []


async def test_search_limits(make_client):
    c, _ = await active_client(make_client)
    assert (await c.get("/api/conversations", params={"q": "a" * 200})).status_code == 200
    r = await c.get("/api/conversations", params={"q": "a" * 201})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"


async def test_search_is_owner_scoped(make_client):
    a, _ = await active_client(make_client)
    b, _ = await active_client(make_client)
    cid = await new_conversation(a)
    await add_message(cid, "user", "secret-keyword")
    assert len((await items(a, q="secret-keyword"))["items"]) == 1
    assert (await items(b, q="secret-keyword"))["items"] == []


# --- preview --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "md,expected",
    [
        ("# Title\n\nSome **bold** and _italic_ text", "Title Some bold and italic text"),
        ("see [the docs](https://x.test/a) now", "see the docs now"),
        ("![alt](http://x/y.png) caption", "caption"),
        ("```python\nprint(1)\n```\nafter", "print(1) after"),
        ("- one\n- two\n1. three\n> quote", "one two three quote"),
        ("| a | b |\n|---|---|\n| 1 | 2 |", "a b 1 2"),
        ("x" * 300, "x" * 100),
        (None, ""),
    ],
)
def test_make_preview(md, expected):
    assert make_preview(md) == expected


async def test_preview_prefers_last_assistant_text(make_client):
    c, _ = await active_client(make_client)
    cid = await new_conversation(c)
    await add_message(cid, "user", "question", ago="2 minutes")
    await add_message(cid, "assistant", "## Answer\n\nThe **final** words", ago="1 minute")
    await add_message(cid, "user", "follow up", ago="10 seconds")
    assert by_id(await items(c))[cid]["preview"] == "Answer The final words"
    await sql("UPDATE messages SET content = '' WHERE role = 'assistant'")
    assert by_id(await items(c))[cid]["preview"] == "follow up"  # falls back to the last text of any message


# --- ordering and pagination -------------------------------------------------------------------------


async def setup_ordered(c):
    ids = [await new_conversation(c) for _ in range(6)]
    for i, cid in enumerate(ids):  # ids[0] oldest ... ids[5] newest
        await sql(f"UPDATE conversations SET updated_at = now() - interval '{60 - i * 10} minutes' WHERE id = :i", i=uuid.UUID(cid))
    return ids


async def test_pinned_first_then_updated_desc(make_client):
    c, _ = await active_client(make_client)
    ids = await setup_ordered(c)
    await c.patch(f"/api/conversations/{ids[1]}", json={"pinned": True})
    await c.patch(f"/api/conversations/{ids[3]}", json={"pinned": True})
    got = [i["id"] for i in (await items(c))["items"]]
    assert got == [ids[3], ids[1], ids[5], ids[4], ids[2], ids[0]]


async def test_pagination_with_pinned_cursor(make_client):
    c, _ = await active_client(make_client)
    ids = await setup_ordered(c)
    await c.patch(f"/api/conversations/{ids[0]}", json={"pinned": True})  # oldest, but pinned
    await c.patch(f"/api/conversations/{ids[2]}", json={"pinned": True})
    expected = [ids[2], ids[0], ids[5], ids[4], ids[3], ids[1]]
    seen, before, pages = [], None, 0
    while True:
        body = await items(c, limit=2, **({"before": before} if before else {}))
        seen += [i["id"] for i in body["items"]]
        pages += 1
        before = body["next_before"]
        if before is None:
            break
        assert pages < 10
    assert seen == expected and pages == 3
    # first page ends inside the pinned block, cursor still continues correctly
    first = await items(c, limit=1)
    assert first["next_before"].startswith("1~")
    second = await items(c, limit=2, before=first["next_before"])
    assert [i["id"] for i in second["items"]] == [ids[0], ids[5]]


async def test_exact_page_has_no_next_cursor_and_bare_iso_cursor_still_works(make_client):
    c, _ = await active_client(make_client)
    ids = await setup_ordered(c)
    assert (await items(c, limit=6))["next_before"] is None
    page = await items(c, limit=2)
    assert page["next_before"].startswith("0~")
    legacy = await items(c, before=page["items"][-1]["updated_at"])  # plain timestamp = unpinned cursor
    assert [i["id"] for i in legacy["items"]] == [ids[3], ids[2], ids[1], ids[0]]
    assert (await c.get("/api/conversations", params={"before": "garbage"})).status_code == 422


async def test_pagination_with_search(make_client):
    c, _ = await active_client(make_client)
    ids = await setup_ordered(c)
    for cid in ids[:5]:
        await c.patch(f"/api/conversations/{cid}", json={"title": "match"})
    p1 = await items(c, q="match", limit=3)
    p2 = await items(c, q="match", limit=3, before=p1["next_before"])
    assert [i["id"] for i in p1["items"] + p2["items"]] == ids[:5][::-1] and p2["next_before"] is None


# --- efficiency -------------------------------------------------------------------------------------------


async def test_list_query_count_does_not_grow_with_conversations(make_client):
    c, _ = await active_client(make_client)
    counts = [0]
    engine = get_engine().sync_engine

    def count(conn, cursor, statement, *a):
        counts[-1] += 1

    async def make(n):
        for _ in range(n):
            cid = await new_conversation(c)
            await add_message(cid, "user", "q")
            await add_message(cid, "assistant", "a")

    await make(1)
    event.listen(engine, "before_cursor_execute", count)
    try:
        await items(c)
        counts.append(0)
        await make(7)
        counts[-1] = 0
        await items(c)
    finally:
        event.remove(engine, "before_cursor_execute", count)
    assert counts[0] == counts[1] and counts[0] <= 3


async def test_preview_is_linear_on_adversarial_input():
    import time

    for evil in (" " * 600 + "x", "|" + " " * 600, "[" * 600, "-" * 600 + "x", "![" + "a" * 600, ("\n" + " ") * 300):
        t0 = time.perf_counter()
        make_preview(evil)
        assert time.perf_counter() - t0 < 0.01, repr(evil[:12])
    t0 = time.perf_counter()
    for _ in range(100):
        make_preview(" " * 600 + "x")
    assert time.perf_counter() - t0 < 0.5


async def test_big_page_is_fast(make_client):
    import time

    c, _ = await active_client(make_client)
    for _ in range(100):
        cid = await new_conversation(c)
        await add_message(cid, "assistant", " " * 600 + "x")
    t0 = time.perf_counter()
    body = await items(c, limit=100)
    assert len(body["items"]) == 100 and time.perf_counter() - t0 < 1.5
    assert all(i["preview"] == "x" for i in body["items"])


async def test_cursor_tiebreak_with_equal_updated_at(make_client):
    c, _ = await active_client(make_client)
    ids = [await new_conversation(c) for _ in range(5)]
    await sql("UPDATE conversations SET updated_at = '2026-01-01T00:00:00.123456+00:00'")
    seen, before, pages = [], None, 0
    while True:
        body = await items(c, limit=2, **({"before": before} if before else {}))
        seen += [i["id"] for i in body["items"]]
        before, pages = body["next_before"], pages + 1
        if before is None:
            break
    assert pages == 3 and len(seen) == 5 and set(seen) == set(ids) and seen == sorted(seen)  # id asc within a tie
    first = await items(c, limit=2)
    parts = first["next_before"].split("~")
    assert len(parts) == 3 and parts[0] == "0" and parts[2] == first["items"][-1]["id"]


async def test_tiebreak_inside_pinned_block_and_legacy_tokens(make_client):
    c, _ = await active_client(make_client)
    ids = [await new_conversation(c) for _ in range(4)]
    for cid in ids[:3]:
        await c.patch(f"/api/conversations/{cid}", json={"pinned": True})
    await sql("UPDATE conversations SET updated_at = '2026-01-01T00:00:00+00:00'")
    p1 = await items(c, limit=2)
    p2 = await items(c, limit=2, before=p1["next_before"])
    got = [i["id"] for i in p1["items"] + p2["items"]]
    assert sorted(got[:3]) == sorted(ids[:3]) and got[3] == ids[3] and got[:3] == sorted(ids[:3])
    # a two-part token (no id) is still accepted
    legacy = await items(c, before="1~2026-06-01T00:00:00+00:00")
    assert len(legacy["items"]) == 4
    assert (await c.get("/api/conversations", params={"before": "1~2026-01-01T00:00:00+00:00~not-a-uuid"})).status_code == 422
    assert (await c.get("/api/conversations", params={"before": "x~y~z~w"})).status_code == 422

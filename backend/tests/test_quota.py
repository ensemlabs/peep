from datetime import UTC, datetime

from app.db import get_sessionmaker
from app.services.quota import period_bounds, used_tokens, used_tokens_many
from tests.conftest import active_client, create_user, login, new_conversation, send_message, sql
from tests.test_admin import admin_client


def dt(*a):
    return datetime(*a, tzinfo=UTC)


def test_period_bounds():
    now = dt(2026, 11, 24, 15, 30, 5)
    assert period_bounds("day", now) == (dt(2026, 11, 24), dt(2026, 11, 25))
    assert period_bounds("month", now) == (dt(2026, 11, 1), dt(2026, 12, 1))
    assert period_bounds("month", dt(2026, 12, 31, 23, 59)) == (dt(2026, 12, 1), dt(2027, 1, 1))
    assert period_bounds("day", dt(2026, 2, 28, 23)) == (dt(2026, 2, 28), dt(2026, 3, 1))
    # boundary instant belongs to the new window
    assert period_bounds("day", dt(2026, 11, 25))[0] == dt(2026, 11, 25)


async def add_usage(user_id, tokens, when=None):
    await sql(
        "INSERT INTO token_usage (id, user_id, tokens, created_at) VALUES (gen_random_uuid(), :u, :t, COALESCE(:w, now()))",
        u=user_id, t=tokens, w=when,
    )


async def test_window_boundaries_day_vs_month():
    user = await create_user("w@example.com")
    now = dt(2026, 11, 24, 12)
    await add_usage(user.id, 1, dt(2026, 10, 31, 23, 59))  # previous month
    await add_usage(user.id, 10, dt(2026, 11, 1))  # month start, this month
    await add_usage(user.id, 100, dt(2026, 11, 23, 23, 59))  # yesterday
    await add_usage(user.id, 1000, dt(2026, 11, 24))  # day start
    async with get_sessionmaker()() as db:
        assert await used_tokens(db, user.id, "month", now) == 1110
        assert await used_tokens(db, user.id, "day", now) == 1000
        assert await used_tokens_many(db, [], now) == {}


async def test_used_tokens_many_per_user_period():
    day_user = await create_user("d@example.com")
    month_user = await create_user("m@example.com")
    idle = await create_user("i@example.com")
    await sql("UPDATE users SET token_period = 'day' WHERE id = :i", i=day_user.id)
    now = dt(2026, 11, 24, 12)
    for u in (day_user, month_user):
        await add_usage(u.id, 5, dt(2026, 11, 10))
        await add_usage(u.id, 7, dt(2026, 11, 24, 1))
    async with get_sessionmaker()() as db:
        from app.models import User

        users = [await db.get(User, u.id) for u in (day_user, month_user, idle)]
        got = await used_tokens_many(db, users, now)
    assert got == {day_user.id: 7, month_user.id: 12, idle.id: 0}


async def test_admin_list_tokens_used(make_client):
    c, _ = await admin_client(make_client)
    u = await create_user("u@example.com")
    await add_usage(u.id, 42)
    items = {i["email"]: i for i in (await c.get("/api/admin/users")).json()["items"]}
    assert items["u@example.com"]["tokens_used"] == 42 and items["admin@example.com"]["tokens_used"] == 0


async def test_me_quota_shape(make_client):
    c, user = await active_client(make_client)
    q = (await c.get("/api/auth/me")).json()["quota"]
    assert set(q) == {"limit", "period", "used", "resets_at"}
    assert (q["limit"], q["period"], q["used"]) == (None, "month", 0)
    assert q["resets_at"].endswith("Z") and q["resets_at"].endswith("T00:00:00Z") and q["resets_at"][8:10] == "01"
    await sql("UPDATE users SET token_limit = 50, token_period = 'day' WHERE id = :i", i=user.id)
    await add_usage(user.id, 20)
    r = (await c.get("/api/auth/me")).json()
    assert r["user"]["token_limit"] == 50 and r["user"]["token_period"] == "day"
    assert r["quota"]["limit"] == 50 and r["quota"]["used"] == 20 and r["quota"]["period"] == "day"


async def test_usage_recorded_when_run_finishes(make_client):
    c, user = await active_client(make_client)
    cid = await new_conversation(c)
    r, events = await send_message(c, cid, "hi", model="replay:agent-demo")
    assert r.status_code == 200
    done = [d for n, d in events if n == "done"][0]
    rows = await sql("SELECT tokens, message_id FROM token_usage WHERE user_id = :u", u=user.id)
    usage = (await sql("SELECT usage FROM messages WHERE id = :i", i=done["message_id"]))[0][0]
    assert usage and usage["total_tokens"] > 0
    assert len(rows) == 1 and rows[0][0] == usage["total_tokens"] and str(rows[0][1]) == done["message_id"]
    assert (await c.get("/api/auth/me")).json()["quota"]["used"] == usage["total_tokens"]


async def test_quota_enforcement(make_client):
    c, user = await active_client(make_client)
    cid = await new_conversation(c)
    await sql("UPDATE users SET token_limit = 100 WHERE id = :i", i=user.id)
    await add_usage(user.id, 99)
    r, _ = await send_message(c, cid, "under", model="replay:error-demo")
    assert r.status_code == 200  # under the limit: allowed
    await add_usage(user.id, 1)  # exactly at the limit
    r, _ = await send_message(c, cid, "at limit", model="replay:error-demo")
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "quota_exceeded"
    assert r.json()["error"]["message"] == "Token limit reached for this period"
    assert "retry-after" not in r.headers
    await add_usage(user.id, 500)
    r, _ = await send_message(c, cid, "over", model="replay:error-demo")
    assert r.status_code == 429
    # raising or removing the limit unblocks
    await sql("UPDATE users SET token_limit = NULL WHERE id = :i", i=user.id)
    r, _ = await send_message(c, cid, "free", model="replay:error-demo")
    assert r.status_code == 200


async def test_deleting_conversations_does_not_reset_usage(make_client):
    c, user = await active_client(make_client)
    cid = await new_conversation(c)
    r, _ = await send_message(c, cid, "hi", model="replay:agent-demo")
    assert r.status_code == 200
    used = (await c.get("/api/auth/me")).json()["quota"]["used"]
    assert used > 0
    assert (await c.delete(f"/api/conversations/{cid}")).status_code == 204
    assert (await c.get("/api/auth/me")).json()["quota"]["used"] == used
    await sql("UPDATE users SET token_limit = :l WHERE id = :i", l=used, i=user.id)
    cid2 = await new_conversation(c)
    r, _ = await send_message(c, cid2, "again", model="replay:agent-demo")
    assert r.status_code == 429 and r.json()["error"]["code"] == "quota_exceeded"


async def test_user_delete_cascades_usage(make_client):
    c, _ = await admin_client(make_client)
    u = await create_user("u@example.com")
    await add_usage(u.id, 5)
    assert (await c.delete(f"/api/admin/users/{u.id}")).status_code == 204
    assert (await sql("SELECT count(*) FROM token_usage"))[0][0] == 0

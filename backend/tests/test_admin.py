import uuid

from tests.conftest import PASSWORD, create_user, login, new_email, register, sql


async def admin_client(make_client, email="admin@example.com"):
    admin = await create_user(email, role="admin", display_name="The Admin")
    c = make_client()
    assert (await login(c, email)).status_code == 200
    return c, admin


async def test_admin_routes_require_admin(client, make_client):
    assert (await client.get("/api/admin/users")).status_code == 401
    await create_user("u@example.com")
    await login(client, "u@example.com")
    r = await client.get("/api/admin/users")
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    uid = str(uuid.uuid4())
    assert (await client.patch(f"/api/admin/users/{uid}", json={"status": "active"})).status_code == 403
    assert (await client.delete(f"/api/admin/users/{uid}")).status_code == 403
    assert (await client.post(f"/api/admin/users/{uid}/password", json={"new_password": PASSWORD})).status_code == 403


async def test_pending_admin_is_blocked(client):
    await create_user("pa@example.com", role="admin", status="pending")
    await login(client, "pa@example.com")
    r = await client.get("/api/admin/users")
    assert r.status_code == 403 and r.json()["error"]["code"] == "account_pending"


async def test_list_search_filter_paging_order(make_client):
    c, _ = await admin_client(make_client)
    await create_user("alice@example.com", display_name="Alice Smith")
    await create_user("bob@example.com", display_name="Bob")
    await create_user("pend1@example.com", status="pending")
    await create_user("off@example.com", status="disabled")
    await create_user("under_score@example.com", display_name="100% real")

    body = (await c.get("/api/admin/users")).json()
    assert body["total"] == 6
    assert body["items"][0]["status"] == "pending"
    assert set(body["items"][0]) == {
        "id", "email", "display_name", "role", "status", "created_at", "last_login_at", "approved_at",
    }
    assert [u["email"] for u in (await c.get("/api/admin/users", params={"q": "ALICE"})).json()["items"]] == ["alice@example.com"]
    assert (await c.get("/api/admin/users", params={"q": "smith"})).json()["total"] == 1
    assert (await c.get("/api/admin/users", params={"q": "100%"})).json()["total"] == 1
    assert (await c.get("/api/admin/users", params={"q": "%"})).json()["total"] == 1  # escaped, not a wildcard
    assert (await c.get("/api/admin/users", params={"q": "_"})).json()["total"] == 1
    r = (await c.get("/api/admin/users", params={"status": "disabled"})).json()
    assert r["total"] == 1 and r["items"][0]["email"] == "off@example.com"
    page1 = (await c.get("/api/admin/users", params={"limit": 2, "offset": 0})).json()
    page2 = (await c.get("/api/admin/users", params={"limit": 2, "offset": 2})).json()
    assert page1["total"] == page2["total"] == 6
    assert len(page1["items"]) == len(page2["items"]) == 2
    assert {u["id"] for u in page1["items"]}.isdisjoint(u["id"] for u in page2["items"])
    assert (await c.get("/api/admin/users", params={"limit": 101})).status_code == 422
    assert (await c.get("/api/admin/users", params={"status": "bogus"})).status_code == 422


async def test_approve_sets_approved_fields_and_unlocks(make_client):
    c, admin = await admin_client(make_client)
    u = make_client()
    r = await register(u, "p@example.com")
    uid = r.json()["user"]["id"]
    assert (await u.get("/api/models")).status_code == 403
    r = await c.patch(f"/api/admin/users/{uid}", json={"status": "active"})
    assert r.status_code == 200
    user = r.json()["user"]
    assert user["status"] == "active" and user["approved_at"]
    assert (await sql("SELECT approved_by FROM users WHERE id = :i", i=uuid.UUID(uid)))[0][0] == uuid.UUID(str(admin.id))
    assert (await u.get("/api/models")).status_code == 200  # same session now has access


async def test_role_change_and_validation(make_client):
    c, _ = await admin_client(make_client)
    target = await create_user("t@example.com")
    r = await c.patch(f"/api/admin/users/{target.id}", json={"role": "admin"})
    assert r.json()["user"]["role"] == "admin"
    assert (await c.patch(f"/api/admin/users/{target.id}", json={"role": "root"})).status_code == 422
    assert (await c.patch(f"/api/admin/users/{uuid.uuid4()}", json={"role": "user"})).status_code == 404
    assert (await c.patch("/api/admin/users/not-a-uuid", json={})).status_code == 422


async def test_disable_revokes_sessions_and_blocks_login(make_client):
    c, _ = await admin_client(make_client)
    target = await create_user("t@example.com")
    u = make_client()
    await login(u, "t@example.com")
    r = await c.patch(f"/api/admin/users/{target.id}", json={"status": "disabled"})
    assert r.json()["user"]["status"] == "disabled"
    assert (await u.get("/api/auth/me")).status_code == 401
    r = await login(make_client(), "t@example.com")
    assert r.status_code == 403 and r.json()["error"]["code"] == "account_disabled"


async def test_self_modify_and_delete_rejected(make_client):
    c, admin = await admin_client(make_client)
    for resp in (
        await c.patch(f"/api/admin/users/{admin.id}", json={"status": "disabled"}),
        await c.patch(f"/api/admin/users/{admin.id}", json={"role": "user"}),
        await c.delete(f"/api/admin/users/{admin.id}"),
        await c.post(f"/api/admin/users/{admin.id}/password", json={"new_password": PASSWORD + "x"}),
    ):
        assert resp.status_code == 400 and resp.json()["error"]["code"] == "cannot_modify_self"
    assert (await c.get("/api/auth/me")).json()["user"]["role"] == "admin"


async def test_reset_password(make_client):
    c, _ = await admin_client(make_client)
    target = await create_user("t@example.com")
    u = make_client()
    await login(u, "t@example.com")
    r = await c.post(f"/api/admin/users/{target.id}/password", json={"new_password": "short"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "weak_password"
    r = await c.post(f"/api/admin/users/{target.id}/password", json={"new_password": "brand-new-password"})
    assert r.status_code == 204
    assert (await u.get("/api/auth/me")).status_code == 401  # revoked
    assert (await login(make_client(), "t@example.com", PASSWORD)).status_code == 401
    assert (await login(make_client(), "t@example.com", "brand-new-password")).status_code == 200
    assert (await c.post(f"/api/admin/users/{uuid.uuid4()}/password", json={"new_password": PASSWORD})).status_code == 404


async def test_delete_user_cascades(make_client):
    c, _ = await admin_client(make_client)
    target = await create_user("t@example.com")
    u = make_client()
    await login(u, "t@example.com")
    assert (await c.delete(f"/api/admin/users/{target.id}")).status_code == 204
    assert (await u.get("/api/auth/me")).status_code == 401
    assert (await sql("SELECT count(*) FROM users WHERE email = 't@example.com'"))[0][0] == 0
    assert (await sql("SELECT count(*) FROM sessions"))[0][0] == 1  # only the admin's
    assert (await c.delete(f"/api/admin/users/{target.id}")).status_code == 404

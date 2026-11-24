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
        "token_limit", "token_period", "tokens_used",
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


# --- create user ---------------------------------------------------------------------------------


async def audit_rows(action=None):
    q = "SELECT action, actor_email, target_email, detail FROM admin_audit"
    if action:
        return await sql(q + " WHERE action = :a ORDER BY created_at", a=action)
    return await sql(q + " ORDER BY created_at")


async def test_create_user_happy_and_audit(make_client):
    c, admin = await admin_client(make_client)
    r = await c.post(
        "/api/admin/users",
        json={"email": " New@Example.com ", "display_name": " New One ", "password": PASSWORD, "role": "admin"},
    )
    assert r.status_code == 201, r.text
    u = r.json()["user"]
    assert u["email"] == "new@example.com" and u["display_name"] == "New One"
    assert u["role"] == "admin" and u["status"] == "active" and u["approved_at"]
    assert u["token_limit"] is None and u["token_period"] == "month"
    assert (await sql("SELECT approved_by FROM users WHERE id = :i", i=uuid.UUID(u["id"])))[0][0] == admin.id
    n = make_client()
    assert (await login(n, "new@example.com")).status_code == 200
    rows = await audit_rows("user.create")
    assert len(rows) == 1 and rows[0][1:3] == ("admin@example.com", "new@example.com")
    assert rows[0][3] == {"role": "admin", "status": "active"}


async def test_create_user_pending(make_client):
    c, _ = await admin_client(make_client)
    r = await c.post("/api/admin/users", json={"email": "p@example.com", "display_name": "P", "password": PASSWORD, "status": "pending"})
    u = r.json()["user"]
    assert r.status_code == 201 and u["status"] == "pending" and u["approved_at"] is None and u["role"] == "user"


async def test_create_user_validation(make_client):
    c, _ = await admin_client(make_client)
    await create_user("dup@example.com")
    ok = {"email": "x@example.com", "display_name": "X", "password": PASSWORD}
    r = await c.post("/api/admin/users", json={**ok, "email": "DUP@example.com"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "email_taken"
    r = await c.post("/api/admin/users", json={**ok, "email": "nope"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_email"
    r = await c.post("/api/admin/users", json={**ok, "display_name": "  "})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_display_name"
    r = await c.post("/api/admin/users", json={**ok, "password": "short"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "weak_password"
    assert (await c.post("/api/admin/users", json={**ok, "role": "root"})).status_code == 422
    assert (await c.post("/api/admin/users", json={**ok, "status": "disabled"})).status_code == 422
    assert await audit_rows() == []


async def test_create_user_requires_admin(client):
    await create_user("u@example.com")
    await login(client, "u@example.com")
    ok = {"email": "x@example.com", "display_name": "X", "password": PASSWORD}
    assert (await client.post("/api/admin/users", json=ok)).status_code == 403
    assert (await client.post("/api/admin/users/bulk", json={"ids": [str(uuid.uuid4())], "action": "delete"})).status_code == 403
    assert (await client.get("/api/admin/audit")).status_code == 403


# --- bulk ------------------------------------------------------------------------------------------


async def bulk(c, ids, action):
    return await c.post("/api/admin/users/bulk", json={"ids": [str(i) for i in ids], "action": action})


async def test_bulk_approve_enable_disable(make_client):
    c, admin = await admin_client(make_client)
    p1 = await create_user("p1@example.com", status="pending")
    p2 = await create_user("p2@example.com", status="pending")
    a1 = await create_user("a1@example.com")
    d1 = await create_user("d1@example.com", status="disabled")
    ghost = uuid.uuid4()

    r = await bulk(c, [p1.id, p2.id, a1.id, admin.id, ghost, p1.id], "approve")
    assert r.status_code == 200
    body = r.json()
    assert body["done"] == [str(p1.id), str(p2.id)]  # duplicate id merged
    assert {(s["id"], s["reason"]) for s in body["skipped"]} == {
        (str(a1.id), "no_change"), (str(admin.id), "self"), (str(ghost), "not_found"),
    }
    assert (await sql("SELECT status, approved_by FROM users WHERE id = :i", i=p1.id))[0] == ("active", admin.id)

    r = await bulk(c, [d1.id, a1.id], "enable")
    assert r.json()["done"] == [str(d1.id)] and r.json()["skipped"] == [{"id": str(a1.id), "reason": "no_change"}]
    assert (await sql("SELECT status FROM users WHERE id = :i", i=d1.id))[0][0] == "active"

    u = make_client()
    await login(u, "a1@example.com")
    assert (await u.get("/api/models")).status_code == 200
    r = await bulk(c, [a1.id, p2.id, d1.id], "disable")
    assert len(r.json()["done"]) == 3
    assert (await u.get("/api/models")).status_code == 401  # sessions revoked
    assert (await sql("SELECT count(*) FROM users WHERE status = 'disabled'"))[0][0] == 3
    r = await bulk(c, [a1.id], "disable")
    assert r.json()["skipped"] == [{"id": str(a1.id), "reason": "no_change"}]


async def test_bulk_delete_and_audit(make_client):
    c, admin = await admin_client(make_client)
    t1 = await create_user("t1@example.com")
    t2 = await create_user("t2@example.com", status="pending")
    r = await bulk(c, [t1.id, t2.id, admin.id], "delete")
    assert r.json()["done"] == [str(t1.id), str(t2.id)]
    assert r.json()["skipped"] == [{"id": str(admin.id), "reason": "self"}]
    assert (await sql("SELECT count(*) FROM users"))[0][0] == 1
    rows = await audit_rows("user.delete")
    assert {x[2] for x in rows} == {"t1@example.com", "t2@example.com"}
    assert all(x[3] == {"bulk": True} for x in rows)


async def test_bulk_status_audit_rows(make_client):
    c, _ = await admin_client(make_client)
    p = await create_user("p@example.com", status="pending")
    await bulk(c, [p.id], "approve")
    rows = await audit_rows("user.status")
    assert len(rows) == 1 and rows[0][3] == {"from": "pending", "to": "active", "bulk": True}


async def test_bulk_validation(make_client):
    c, _ = await admin_client(make_client)
    assert (await bulk(c, [uuid.uuid4() for _ in range(101)], "delete")).status_code == 422
    assert (await bulk(c, [], "delete")).status_code == 422
    assert (await bulk(c, [uuid.uuid4()], "explode")).status_code == 422
    assert (await c.post("/api/admin/users/bulk", json={"ids": ["x"], "action": "delete"})).status_code == 422
    r = await bulk(c, [uuid.uuid4() for _ in range(100)], "delete")
    assert r.status_code == 200 and len(r.json()["skipped"]) == 100


# --- audit list ------------------------------------------------------------------------------------


async def test_audit_list_order_filter_paging(make_client):
    c, _ = await admin_client(make_client)
    a = await create_user("alpha@example.com", status="pending")
    b = await create_user("be_ta@example.com")
    await c.patch(f"/api/admin/users/{a.id}", json={"status": "active"})
    await c.patch(f"/api/admin/users/{b.id}", json={"role": "admin"})
    await c.post(f"/api/admin/users/{b.id}/password", json={"new_password": PASSWORD})
    r = (await c.get("/api/admin/audit")).json()
    assert r["total"] == 3
    assert [i["action"] for i in r["items"]] == ["user.password_reset", "user.role", "user.status"]  # newest first
    item = r["items"][0]
    assert set(item) == {"id", "actor_id", "actor_email", "target_id", "target_email", "action", "detail", "created_at"}
    assert item["target_email"] == "be_ta@example.com" and item["detail"] == {} and item["created_at"].endswith("Z")
    assert (await c.get("/api/admin/audit", params={"action": "user.role"})).json()["total"] == 1
    assert (await c.get("/api/admin/audit", params={"action": "user.nope"})).status_code == 422
    assert (await c.get("/api/admin/audit", params={"q": "ALPHA"})).json()["total"] == 1
    assert (await c.get("/api/admin/audit", params={"q": "admin@"})).json()["total"] == 3  # actor email
    assert (await c.get("/api/admin/audit", params={"q": "_"})).json()["total"] == 2  # escaped: be_ta only
    assert (await c.get("/api/admin/audit", params={"q": "%"})).json()["total"] == 0
    p1 = (await c.get("/api/admin/audit", params={"limit": 2})).json()
    p2 = (await c.get("/api/admin/audit", params={"limit": 2, "offset": 2})).json()
    assert len(p1["items"]) == 2 and len(p2["items"]) == 1 and p1["total"] == p2["total"] == 3
    assert (await c.get("/api/admin/audit", params={"limit": 101})).status_code == 422
    assert (await c.get("/api/admin/audit", params={"limit": 0})).status_code == 422


async def test_audit_survives_target_delete(make_client):
    c, admin = await admin_client(make_client)
    t = await create_user("gone@example.com")
    assert (await c.delete(f"/api/admin/users/{t.id}")).status_code == 204
    r = (await c.get("/api/admin/audit", params={"q": "gone@"})).json()
    assert r["total"] == 1
    assert r["items"][0]["action"] == "user.delete" and r["items"][0]["target_id"] == str(t.id)
    assert r["items"][0]["actor_id"] == str(admin.id)


# --- quota via patch -------------------------------------------------------------------------------


async def test_patch_quota_set_unset_untouched(make_client):
    c, _ = await admin_client(make_client)
    t = await create_user("q@example.com")
    url = f"/api/admin/users/{t.id}"
    u = (await c.patch(url, json={"token_limit": 1000, "token_period": "day"})).json()["user"]
    assert (u["token_limit"], u["token_period"]) == (1000, "day")
    u = (await c.patch(url, json={"role": "admin"})).json()["user"]  # unset fields untouched
    assert (u["token_limit"], u["token_period"]) == (1000, "day")
    u = (await c.patch(url, json={"token_period": "month"})).json()["user"]
    assert (u["token_limit"], u["token_period"]) == (1000, "month")
    u = (await c.patch(url, json={"token_limit": None})).json()["user"]
    assert (u["token_limit"], u["token_period"]) == (None, "month")
    rows = await audit_rows("user.quota")
    assert [r[3] for r in rows] == [
        {"from": {"limit": None, "period": "month"}, "to": {"limit": 1000, "period": "day"}},
        {"from": {"limit": 1000, "period": "day"}, "to": {"limit": 1000, "period": "month"}},
        {"from": {"limit": 1000, "period": "month"}, "to": {"limit": None, "period": "month"}},
    ]


async def test_patch_quota_out_of_range(make_client):
    c, _ = await admin_client(make_client)
    t = await create_user("q@example.com")
    url = f"/api/admin/users/{t.id}"
    for bad in ({"token_limit": 0}, {"token_limit": -5}, {"token_limit": 1_000_000_000_001}, {"token_period": "week"}, {"token_limit": "x"}):
        assert (await c.patch(url, json=bad)).status_code == 422, bad
    assert await audit_rows() == []


async def test_patch_audit_one_row_per_real_change(make_client):
    c, _ = await admin_client(make_client)
    t = await create_user("q@example.com")
    url = f"/api/admin/users/{t.id}"
    r = await c.patch(url, json={"status": "disabled", "role": "admin", "token_limit": 5})
    assert r.status_code == 200
    assert sorted(x[0] for x in await audit_rows()) == ["user.quota", "user.role", "user.status"]
    st = (await audit_rows("user.status"))[0][3]
    assert st == {"from": "active", "to": "disabled"}
    # nothing changes -> nothing written
    await c.patch(url, json={"status": "disabled", "role": "admin", "token_limit": 5, "token_period": "month"})
    await c.patch(url, json={})
    assert len(await audit_rows()) == 3


async def test_password_reset_and_delete_audit(make_client):
    c, _ = await admin_client(make_client)
    t = await create_user("t@example.com")
    await c.post(f"/api/admin/users/{t.id}/password", json={"new_password": PASSWORD})
    await c.delete(f"/api/admin/users/{t.id}")
    assert [(r[0], r[3]) for r in await audit_rows()] == [("user.password_reset", {}), ("user.delete", {})]
    # a rejected weak password writes nothing
    t2 = await create_user("t2@example.com")
    await c.post(f"/api/admin/users/{t2.id}/password", json={"new_password": "short"})
    assert len(await audit_rows()) == 2


async def test_delete_commits_even_if_object_cleanup_fails(make_client, monkeypatch):
    from app.routers import admin as admin_router

    async def boom(user_id, thumbs=None):
        raise RuntimeError("minio down")

    monkeypatch.setattr(admin_router, "delete_user_objects", boom)
    c, _ = await admin_client(make_client)
    t1 = await create_user("t1@example.com")
    t2 = await create_user("t2@example.com")
    t3 = await create_user("t3@example.com")
    assert (await c.delete(f"/api/admin/users/{t1.id}")).status_code == 204
    r = await bulk(c, [t2.id, t3.id], "delete")
    assert r.status_code == 200 and len(r.json()["done"]) == 2
    assert (await sql("SELECT count(*) FROM users"))[0][0] == 1
    assert len(await audit_rows("user.delete")) == 3

import pytest

from datetime import UTC, datetime, timedelta

from tests.conftest import PASSWORD, create_user, login, new_email, register, sql

USER_KEYS = {"id", "email", "display_name", "role", "status", "created_at", "last_login_at", "approved_at", "token_limit", "token_period"}


async def test_register_creates_pending_user_with_cookie(client):
    r = await register(client, "New.User@Example.com", name="  Nia  ")
    assert r.status_code == 201
    user = r.json()["user"]
    assert set(user) == USER_KEYS
    assert user["email"] == "new.user@example.com"
    assert user["display_name"] == "Nia"
    assert user["status"] == "pending" and user["role"] == "user"
    assert user["created_at"].endswith("Z") and user["approved_at"] is None
    cookie = r.headers["set-cookie"].lower()
    assert "ec_session=" in cookie and "httponly" in cookie and "samesite=lax" in cookie and "path=/" in cookie
    assert "secure" not in cookie
    assert (await client.get("/api/auth/me")).json()["user"]["email"] == "new.user@example.com"


async def test_password_hash_is_argon2id(client):
    await register(client, "a@example.com")
    rows = await sql("SELECT password_hash FROM users")
    assert rows[0][0].startswith("$argon2id$")
    assert PASSWORD not in rows[0][0]


async def test_session_token_stored_hashed(client):
    r = await register(client, "a@example.com")
    token = client.cookies.get("ec_session")
    assert token and len(token) >= 43
    rows = await sql("SELECT token_hash FROM sessions")
    assert len(rows) == 1 and token.encode() not in bytes(rows[0][0])


async def test_pending_user_blocked_from_active_routes(client):
    await register(client, "a@example.com")
    r = await client.get("/api/models")
    assert r.status_code == 403
    assert r.json() == {"error": {"code": "account_pending", "message": "Your account is waiting for admin approval"}}
    assert (await client.get("/api/auth/me")).status_code == 200


async def test_active_user_reaches_active_routes(client):
    await create_user("a@example.com")
    await login(client, "a@example.com")
    r = await client.get("/api/models")
    assert r.status_code == 200 and r.json()["active"]["id"] == "gemini-pro" and r.json()["items"]


async def test_unauthenticated_me(client):
    r = await client.get("/api/auth/me")
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthenticated"


async def test_register_validation(client):
    r = await register(client, "not-an-email")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_email"
    r = await register(client, "a@example.com", password="short")
    assert r.status_code == 422 and r.json()["error"]["code"] == "weak_password"
    r = await register(client, "a@example.com", password="x" * 129)
    assert r.json()["error"]["code"] == "weak_password"
    r = await register(client, "longenough@example.com", password="LongEnough@Example.com")
    assert r.json()["error"]["code"] == "weak_password"
    r = await register(client, "a@example.com", name="   ")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_display_name"
    r = await register(client, "a@example.com", name="x" * 81)
    assert r.status_code == 422
    r = await register(client, "a" * 250 + "@example.com")
    assert r.json()["error"]["code"] == "invalid_request"


async def test_register_duplicate_email_case_insensitive(client):
    assert (await register(client, "dup@example.com")).status_code == 201
    r = await register(client, "DUP@example.com")
    assert r.status_code == 409 and r.json()["error"]["code"] == "email_taken"


async def test_login_errors_are_identical_for_unknown_and_wrong_password(client):
    await create_user("a@example.com")
    wrong = await login(client, "a@example.com", "wrong-password-1")
    unknown = await login(client, "nobody@example.com", "wrong-password-1")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    assert wrong.json()["error"]["code"] == "invalid_credentials"


async def test_login_ok_sets_last_login_and_cookie(client):
    await create_user("a@example.com")
    r = await login(client, "A@Example.com")
    assert r.status_code == 200
    assert r.json()["user"]["last_login_at"] is not None
    assert "ec_session" in r.headers["set-cookie"]


async def test_pending_user_can_login(client):
    await create_user("p@example.com", status="pending")
    r = await login(client, "p@example.com")
    assert r.status_code == 200 and r.json()["user"]["status"] == "pending"


async def test_logout_invalidates_session(client):
    await create_user("a@example.com")
    await login(client, "a@example.com")
    stolen = client.cookies.get("ec_session")
    r = await client.post("/api/auth/logout")
    assert r.status_code == 204
    assert "ec_session" in r.headers["set-cookie"] and "max-age=0" in r.headers["set-cookie"].lower()
    client.cookies.set("ec_session", stolen)
    assert (await client.get("/api/auth/me")).status_code == 401
    assert (await sql("SELECT count(*) FROM sessions"))[0][0] == 0


async def test_idle_expiry(client):
    await create_user("a@example.com")
    await login(client, "a@example.com")
    await sql("UPDATE sessions SET expires_at = now() - interval '1 minute'")
    r = await client.get("/api/auth/me")
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthenticated"
    assert (await sql("SELECT count(*) FROM sessions"))[0][0] == 0


async def test_absolute_expiry(client):
    await create_user("a@example.com")
    await login(client, "a@example.com")
    await sql("UPDATE sessions SET absolute_expires_at = now() - interval '1 minute'")
    assert (await client.get("/api/auth/me")).status_code == 401
    assert (await sql("SELECT count(*) FROM sessions"))[0][0] == 0


async def test_sliding_refresh_once_per_hour_and_capped(client, settings):
    await create_user("a@example.com")
    await login(client, "a@example.com")
    before = (await sql("SELECT last_seen_at, expires_at FROM sessions"))[0]
    assert "set-cookie" not in (await client.get("/api/auth/me")).headers  # < 1h since last_seen: no refresh
    assert (await sql("SELECT last_seen_at FROM sessions"))[0][0] == before[0]

    await sql("UPDATE sessions SET last_seen_at = now() - interval '2 hours'")
    r = await client.get("/api/auth/me")
    assert "ec_session" in r.headers["set-cookie"]
    seen, exp = (await sql("SELECT last_seen_at, expires_at FROM sessions"))[0]
    assert seen > datetime.now(UTC) - timedelta(minutes=1)
    assert exp > before[1]

    # idle extension never goes beyond the absolute expiry
    await sql(
        "UPDATE sessions SET last_seen_at = now() - interval '2 hours',"
        " absolute_expires_at = now() + interval '1 day'"
    )
    await client.get("/api/auth/me")
    exp, absolute = (await sql("SELECT expires_at, absolute_expires_at FROM sessions"))[0]
    assert exp == absolute


async def test_password_change_revokes_other_sessions(make_client):
    await create_user("a@example.com")
    c1, c2 = make_client(), make_client()
    await login(c1, "a@example.com")
    await login(c2, "a@example.com")
    new = "another-long-password"
    r = await c1.post("/api/auth/password", json={"current_password": "nope-nope-nope", "new_password": new})
    assert r.status_code == 400
    r = await c1.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": "short"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "weak_password"
    r = await c1.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": new})
    assert r.status_code == 204
    assert (await c1.get("/api/auth/me")).status_code == 200
    assert (await c2.get("/api/auth/me")).status_code == 401
    assert (await login(make_client(), "a@example.com", PASSWORD)).status_code == 401
    assert (await login(make_client(), "a@example.com", new)).status_code == 200


def test_cookie_secure_auto_follows_origins(settings, monkeypatch):
    monkeypatch.setattr(settings, "cookie_secure", "auto")
    monkeypatch.setattr(settings, "app_origins", "https://peep.example.com")
    assert settings.cookie_secure_on is True
    monkeypatch.setattr(settings, "app_origins", "https://peep.example.com,http://localhost:8090")
    assert settings.cookie_secure_on is False
    monkeypatch.setattr(settings, "cookie_secure", "true")
    assert settings.cookie_secure_on is True
    monkeypatch.setattr(settings, "app_origins", "https://peep.example.com")
    monkeypatch.setattr(settings, "cookie_secure", "false")
    assert settings.cookie_secure_on is False


async def test_secure_cookie_uses_host_prefix(make_client, settings, monkeypatch):
    monkeypatch.setattr(settings, "cookie_secure", "auto")
    monkeypatch.setattr(settings, "app_origins", "https://peep.example.com")
    c = make_client(origin="https://peep.example.com")
    r = await register(c, "secure@example.com")
    assert r.status_code == 201
    cookie = r.headers["set-cookie"]
    assert cookie.startswith("__Host-ec_session=") and "Secure" in cookie and "Path=/" in cookie
    assert "domain" not in cookie.lower()
    token = cookie.split(";")[0].split("=", 1)[1]
    # the Secure cookie is not replayed over the plain-http test transport, so send it by hand
    c.cookies.clear()
    me = await c.get("/api/auth/me", headers={"Cookie": f"__Host-ec_session={token}"})
    assert me.status_code == 200
    # the plain name is ignored while Secure is on
    old = await c.get("/api/auth/me", headers={"Cookie": f"ec_session={token}"})
    assert old.status_code == 401
    out = await c.post("/api/auth/logout", headers={"Cookie": f"__Host-ec_session={token}"})
    assert out.headers["set-cookie"].startswith("__Host-ec_session=")


def test_settings_validation(monkeypatch):
    from pydantic import ValidationError

    from app.config import Settings

    base = {"database_url": "postgresql+asyncpg://u:p@h/d"}
    assert Settings(**base).max_runs_per_user == 3
    for spelling, on in (("true", True), ("1", True), ("YES", True), ("off", False), ("0", False), ("false", False)):
        assert Settings(**base, cookie_secure=spelling).cookie_secure_on is on
    for bad in ("maybe", ""):
        with pytest.raises(ValidationError):
            Settings(**base, cookie_secure=bad)
    for bad in (0, -1):
        with pytest.raises(ValidationError):
            Settings(**base, max_runs_per_user=bad)

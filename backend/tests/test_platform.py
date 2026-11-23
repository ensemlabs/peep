from sqlalchemy import select

from app.config import get_settings
from app.db import get_sessionmaker
from app.models import Message, User
from app.security import verify_password
from app.services.startup import mark_interrupted_messages, seed_admin
from tests.conftest import PASSWORD, create_user, login, sql


async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


async def test_origin_check(make_client):
    body = {"email": "a@example.com", "password": PASSWORD}
    allowed = sorted(get_settings().origins)[0]

    r = await make_client(origin=None).post("/api/auth/login", json=body)
    assert r.status_code == 403 and r.json()["error"]["code"] == "bad_origin"
    r = await make_client(origin="https://evil.example").post("/api/auth/login", json=body)
    assert r.status_code == 403 and r.json()["error"]["code"] == "bad_origin"
    r = await make_client(origin="null").post("/api/auth/login", json=body)
    assert r.status_code == 403
    r = await make_client(origin=allowed).post("/api/auth/login", json=body)
    assert r.status_code == 401  # passed the origin check, wrong credentials
    r = await make_client(origin=allowed + "/").post("/api/auth/login", json=body)
    assert r.status_code == 401


async def test_origin_referer_fallback(make_client):
    body = {"email": "a@example.com", "password": PASSWORD}
    allowed = sorted(get_settings().origins)[0]
    r = await make_client(origin=None, headers={"Referer": allowed + "/login?x=1"}).post("/api/auth/login", json=body)
    assert r.status_code == 401
    r = await make_client(origin=None, headers={"Referer": "https://evil.example/login"}).post("/api/auth/login", json=body)
    assert r.status_code == 403
    r = await make_client(origin=None, headers={"Referer": "garbage"}).post("/api/auth/login", json=body)
    assert r.status_code == 403
    # Origin wins over a good Referer
    r = await make_client(origin="https://evil.example", headers={"Referer": allowed + "/"}).post("/api/auth/login", json=body)
    assert r.status_code == 403


async def test_origin_check_scope(make_client):
    c = make_client(origin=None)
    assert (await c.get("/api/health")).status_code == 200
    assert (await c.get("/api/auth/me")).status_code == 401  # GET needs no origin
    assert (await c.post("/api/health")).status_code == 405  # exempt path reaches routing
    assert (await c.post("/api/auth/logout")).status_code == 403


async def test_error_shapes(client):
    r = await client.get("/api/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found" and isinstance(r.json()["error"]["message"], str)
    r = await client.put("/api/auth/me")
    assert r.status_code == 405 and r.json()["error"]["code"] == "method_not_allowed"
    r = await client.post("/api/auth/login", json={"email": "a@example.com"})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "invalid_request" and "password" in err["message"]
    r = await client.post("/api/auth/login", content=b"{not json", headers={"content-type": "application/json"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"


async def test_seed_admin_creates_and_is_idempotent(settings, monkeypatch):
    monkeypatch.setattr(settings, "admin_email", " Boss@Example.com ")
    monkeypatch.setattr(settings, "admin_password", "seed-password-123")
    await seed_admin()
    await seed_admin()
    async with get_sessionmaker()() as db:
        users = (await db.execute(select(User))).scalars().all()
    assert len(users) == 1
    u = users[0]
    assert u.email == "boss@example.com" and u.role == "admin" and u.status == "active"
    assert u.password_hash.startswith("$argon2id$")
    assert await verify_password(u.password_hash, "seed-password-123")


async def test_seed_admin_promotes_existing_without_touching_password(settings, monkeypatch):
    await create_user("boss@example.com", status="pending")
    monkeypatch.setattr(settings, "admin_email", "boss@example.com")
    monkeypatch.setattr(settings, "admin_password", "different-seed-password")
    await seed_admin()
    async with get_sessionmaker()() as db:
        u = (await db.execute(select(User))).scalar_one()
    assert (u.role, u.status) == ("admin", "active")
    assert await verify_password(u.password_hash, PASSWORD)
    assert not await verify_password(u.password_hash, "different-seed-password")


async def test_seed_admin_noop_without_env(settings, monkeypatch):
    monkeypatch.setattr(settings, "admin_email", "")
    monkeypatch.setattr(settings, "admin_password", "")
    await seed_admin()
    assert (await sql("SELECT count(*) FROM users"))[0][0] == 0


async def test_streaming_messages_marked_interrupted():
    user = await create_user("a@example.com")
    await sql(
        "INSERT INTO conversations (id, user_id, title) VALUES ('00000000-0000-0000-0000-000000000001', :u, 't')",
        u=user.id,
    )
    for i, status in enumerate(("streaming", "complete"), start=1):
        await sql(
            "INSERT INTO messages (id, conversation_id, role, status)"
            " VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'assistant', :s)",
            s=status,
        )
    await mark_interrupted_messages()
    async with get_sessionmaker()() as db:
        msgs = (await db.execute(select(Message))).scalars().all()
    assert {(m.status, m.error) for m in msgs} == {("error", "interrupted"), ("complete", None)}


async def test_app_lifespan_starts_and_stops(settings, monkeypatch):
    from app.main import app

    monkeypatch.setattr(settings, "admin_email", "")
    async with app.router.lifespan_context(app):
        pass


async def test_lifespan_fails_fast_on_invalid_models_config(settings, monkeypatch, tmp_path):
    import pytest

    from app.main import app
    from app.services import model_registry
    from app.services.model_registry import ConfigError

    bad = tmp_path / "models.yaml"
    bad.write_text("active: nope\nproviders: []\n")
    monkeypatch.setattr(settings, "models_config", str(bad))
    model_registry.reset()
    with pytest.raises(ConfigError):
        async with app.router.lifespan_context(app):
            pass

import pytest
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


async def test_seed_admin_promotes_existing_only_with_matching_password(settings, monkeypatch):
    await create_user("boss@example.com", status="disabled")
    monkeypatch.setattr(settings, "admin_email", "boss@example.com")
    monkeypatch.setattr(settings, "admin_password", PASSWORD)
    await seed_admin()
    async with get_sessionmaker()() as db:
        u = (await db.execute(select(User))).scalar_one()
    assert (u.role, u.status) == ("admin", "active")
    assert await verify_password(u.password_hash, PASSWORD)
    audit = await sql("SELECT actor_id, actor_email, target_email, action, detail FROM admin_audit ORDER BY action")
    assert audit == [
        (None, "system", "boss@example.com", "user.role", {"from": "user", "to": "admin", "via": "seed"}),
        (None, "system", "boss@example.com", "user.status", {"from": "disabled", "to": "active", "via": "seed"}),
    ]


async def test_seed_admin_skips_password_check_for_an_active_admin(settings, monkeypatch, caplog):
    await create_user("boss@example.com", role="admin", status="active")
    monkeypatch.setattr(settings, "admin_email", "boss@example.com")
    monkeypatch.setattr(settings, "admin_password", "not-the-account-password")
    await seed_admin()
    assert "ADMIN_PASSWORD" not in caplog.text
    assert (await sql("SELECT count(*) FROM admin_audit"))[0][0] == 0


async def test_seed_admin_never_promotes_an_account_with_another_password(settings, monkeypatch, caplog):
    # an attacker registered ADMIN_EMAIL first
    await create_user("boss@example.com", status="pending")
    monkeypatch.setattr(settings, "admin_email", "boss@example.com")
    monkeypatch.setattr(settings, "admin_password", "different-seed-password")
    await seed_admin()
    async with get_sessionmaker()() as db:
        u = (await db.execute(select(User))).scalar_one()
    assert (u.role, u.status) == ("user", "pending")
    assert await verify_password(u.password_hash, PASSWORD)
    assert "boss@example.com" in caplog.text and "different-seed-password" not in caplog.text
    assert (await sql("SELECT count(*) FROM admin_audit"))[0][0] == 0


async def test_default_credentials_refused_in_production(settings, monkeypatch):
    from app.services.startup import check_default_credentials

    monkeypatch.setattr(settings, "app_env", "production")
    for name in ("ADMIN_PASSWORD", "POSTGRES_PASSWORD", "MINIO_ROOT_PASSWORD", "S3_SECRET_KEY"):
        monkeypatch.setenv(name, "ok-value")
    check_default_credentials()
    monkeypatch.setenv("MINIO_ROOT_PASSWORD", "change-me-too-please")
    with pytest.raises(RuntimeError) as e:
        check_default_credentials()
    assert "MINIO_ROOT_PASSWORD" in str(e.value) and "change-me-too" not in str(e.value)
    monkeypatch.setattr(settings, "app_env", "test")
    check_default_credentials()


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

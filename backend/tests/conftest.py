import asyncio
import contextlib
import json
import uuid
from datetime import UTC, datetime

import asyncpg
import httpx2 as httpx
import pytest
import pytest_asyncio
import uvicorn
from cryptography.fernet import Fernet
from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.config import get_settings
from app.db import get_engine, get_sessionmaker
from app.main import app
from app.models import User
from app.security import hash_password
from app.services import model_registry, storage
from app.services.runs import registry
from app.services.startup import run_migrations
from app.services.storage import ensure_bucket

PASSWORD = "correct-horse-battery"


async def _create_test_database() -> None:
    url = make_url(get_settings().database_url)
    assert url.database and url.database.endswith("_test"), "refusing to run tests against a non-test database"
    conn = await asyncpg.connect(
        user=url.username, password=url.password, host=url.host, port=url.port or 5432, database="postgres"
    )
    try:
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", url.database)
        if not exists:
            await conn.execute(f'CREATE DATABASE "{url.database}"')
    finally:
        await conn.close()


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _setup():
    await _create_test_database()
    await run_migrations()
    await ensure_bucket()
    await storage.delete_prefix("u/")
    await storage.delete_prefix("thumbs/")
    yield
    await get_engine().dispose()


@pytest_asyncio.fixture(autouse=True)
async def _clean(monkeypatch):
    await registry.wait_idle()
    model_registry.reset()
    async with get_engine().begin() as conn:
        await conn.execute(text("TRUNCATE users, auth_throttle, conversations, messages, files, sessions, skills, plugins CASCADE"))
    # Settings are a shared singleton: patch through monkeypatch so each test starts from defaults.
    s = get_settings()
    for name in (
        "admin_email",
        "admin_password",
        "login_max_failures",
        "ip_login_max",
        "reg_max",
        "session_idle_days",
        "session_absolute_days",
        "session_refresh_seconds",
        "lock_base_seconds",
        "trusted_proxies",
        "llm_base_url",
        "llm_api_key",
        "llm_models",
        "llm_default_model",
        "replay_enabled",
        "replay_time_scale",
        "max_upload_mb",
        "models_config",
        "dev_model_switcher",
        "secrets_key",
    ):
        monkeypatch.setattr(s, name, getattr(s, name))
    monkeypatch.setattr(s, "replay_time_scale", 0.0)
    monkeypatch.setattr(s, "llm_base_url", "http://127.0.0.1:1/v1")  # nothing listens: upstream "down"
    monkeypatch.setattr(s, "llm_models", "gemini-pro,gemini-flash-lite")
    monkeypatch.setattr(s, "llm_default_model", "gemini-pro")
    monkeypatch.setattr(s, "dev_model_switcher", True)  # tests may pick any model / replay
    monkeypatch.setattr(s, "models_config", "/nonexistent/models.yaml")  # => env fallback registry
    monkeypatch.setattr(s, "secrets_key", Fernet.generate_key().decode())
    yield
    await registry.wait_idle()


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture
def make_client():
    """Factory for independent clients (own cookie jar, own peer IP)."""
    clients = []

    def factory(peer: str = "127.0.0.1", origin: str | None = "default", headers: dict | None = None):
        h = dict(headers or {})
        if origin == "default":
            origin = sorted(get_settings().origins)[0]
        if origin:
            h["Origin"] = origin
        transport = httpx.ASGITransport(app=app, client=(peer, 50000), raise_app_exceptions=False)
        c = httpx.AsyncClient(transport=transport, base_url="http://test", headers=h)
        clients.append(c)
        return c

    yield factory


@pytest_asyncio.fixture
async def client(make_client):
    c = make_client()
    yield c
    await c.aclose()


async def create_user(email: str, *, role="user", status="active", password=PASSWORD, display_name="Test") -> User:
    async with get_sessionmaker()() as db:
        user = User(
            email=email,
            display_name=display_name,
            password_hash=await hash_password(password),
            role=role,
            status=status,
            approved_at=datetime.now(UTC) if status == "active" else None,
        )
        db.add(user)
        await db.commit()
        return user


async def sql(query: str, **params):
    async with get_engine().begin() as conn:
        result = await conn.execute(text(query), params)
        return result.fetchall() if result.returns_rows else None


async def login(c: httpx.AsyncClient, email: str, password: str = PASSWORD):
    return await c.post("/api/auth/login", json={"email": email, "password": password})


async def register(c: httpx.AsyncClient, email: str, password: str = PASSWORD, name: str = "Tester"):
    return await c.post("/api/auth/register", json={"email": email, "password": password, "display_name": name})


def new_email() -> str:
    return f"user-{uuid.uuid4().hex[:8]}@example.com"


async def active_client(make_client, email: str | None = None):
    email = email or new_email()
    user = await create_user(email)
    c = make_client()
    r = await login(c, email)
    assert r.status_code == 200, r.text
    return c, user


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.split("\n\n"):
        name, data = None, []
        for line in block.splitlines():
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].lstrip())
        if name:
            events.append((name, json.loads("\n".join(data))))
    return events


async def send_message(c, conv_id, content="hello", model="replay:agent-demo", **extra):
    """POST a message and return (response, parsed events). ASGITransport buffers the whole stream."""
    r = await c.post(
        f"/api/conversations/{conv_id}/messages", json={"content": content, "model": model, **extra}
    )
    return r, (parse_sse(r.text) if r.status_code == 200 else [])


async def new_conversation(c, model=None) -> str:
    r = await c.post("/api/conversations", json={"model": model} if model else {})
    assert r.status_code == 201, r.text
    return r.json()["conversation"]["id"]


@contextlib.asynccontextmanager
async def serve(asgi_app):
    """Run an ASGI app on a random localhost port inside the test loop; yields the base URL."""
    server = uvicorn.Server(uvicorn.Config(asgi_app, host="127.0.0.1", port=0, log_level="warning", lifespan="off"))
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.01)
    port = server.servers[0].sockets[0].getsockname()[1]
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        server.force_exit = True
        await task


@pytest_asyncio.fixture
async def live_api(make_client):
    """The real app on a real socket (needed for true streaming / disconnect tests)."""
    async with serve(app) as url:
        yield url


@pytest.fixture
def use_registry(tmp_path, settings, monkeypatch):
    """Install a models.yaml registry for the test: use_registry(yaml_text)."""

    def install(text: str):
        path = tmp_path / "models.yaml"
        path.write_text(text)
        monkeypatch.setattr(settings, "models_config", str(path))
        model_registry.reset()
        return model_registry.get_registry()

    yield install
    model_registry.reset()

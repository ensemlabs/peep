import json
import uuid

import pytest

from app.config import get_settings
from app.services import secrets
from tests.conftest import active_client, create_user, login, sql

BODY = {
    "name": "My MCP", "description": "docs server", "transport": "http", "url": "https://mcp.example.com/mcp",
    "headers": [{"name": "Authorization", "value": "Bearer TOP-SECRET-TOKEN"}],
}


async def test_create_masks_and_encrypts_at_rest(make_client):
    c, _ = await active_client(make_client)
    r = await c.post("/api/plugins", json=BODY)
    assert r.status_code == 201
    p = r.json()["plugin"]
    assert set(p) == {"id", "name", "description", "transport", "url", "headers", "enabled", "created_at", "updated_at"}
    assert p["headers"] == [{"name": "Authorization", "value_masked": "••••••••"}] and p["enabled"] is True
    assert "TOP-SECRET-TOKEN" not in r.text and "TOP-SECRET-TOKEN" not in (await c.get("/api/plugins")).text

    raw = (await sql("SELECT headers FROM plugins"))[0][0]
    assert "TOP-SECRET-TOKEN" not in json.dumps(raw)
    enc = raw[0]["value_enc"]
    assert enc != "Bearer TOP-SECRET-TOKEN" and enc.startswith("gAAAA")
    assert secrets.decrypt(enc) == "Bearer TOP-SECRET-TOKEN"


async def test_list_get_delete(make_client):
    c, _ = await active_client(make_client)
    a = (await c.post("/api/plugins", json={**BODY, "name": "beta"})).json()["plugin"]
    b = (await c.post("/api/plugins", json={**BODY, "name": "Alpha", "transport": "sse"})).json()["plugin"]
    assert [p["name"] for p in (await c.get("/api/plugins")).json()["items"]] == ["Alpha", "beta"]
    assert b["transport"] == "sse"
    assert (await c.delete(f"/api/plugins/{a['id']}")).status_code == 204
    assert [p["id"] for p in (await c.get("/api/plugins")).json()["items"]] == [b["id"]]
    assert (await c.delete(f"/api/plugins/{a['id']}")).status_code == 404


@pytest.mark.parametrize(
    "patch",
    [
        {"name": ""}, {"name": "x" * 65}, {"name": "bad/name"}, {"name": "emoji 🙂"},
        {"url": "ftp://x.test/mcp"}, {"url": "not a url"}, {"url": "https://user:pw@mcp.example.com/mcp"},
        {"url": "https://user@mcp.example.com/mcp"}, {"url": "http://"}, {"url": "https://x.test/" + "a" * 2100},
        {"url": "javascript:alert(1)"}, {"transport": "websocket"},
        {"headers": [{"name": "Bad Name", "value": "x"}]}, {"headers": [{"name": "X-A", "value": "a\r\nInjected: 1"}]},
        {"headers": [{"name": "X-A", "value": "1"}, {"name": "x-a", "value": "2"}]},
        {"headers": [{"name": f"X-{i}", "value": "1"} for i in range(21)]},
        {"headers": [{"name": "X-Keep", "value": None}]},
    ],
)
async def test_validation(make_client, patch):
    c, _ = await active_client(make_client)
    r = await c.post("/api/plugins", json={**BODY, **patch})
    assert r.status_code == 422, r.text
    assert (await sql("SELECT count(*) FROM plugins"))[0][0] == 0


async def test_duplicate_name_case_insensitive_409(make_client):
    c, _ = await active_client(make_client)
    assert (await c.post("/api/plugins", json=BODY)).status_code == 201
    r = await c.post("/api/plugins", json={**BODY, "name": "my mcp"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "plugin_exists"
    other, _ = await active_client(make_client)
    assert (await other.post("/api/plugins", json=BODY)).status_code == 201  # unique per user only


async def test_patch_null_value_keeps_stored_secret(make_client):
    c, _ = await active_client(make_client)
    p = (await c.post("/api/plugins", json=BODY)).json()["plugin"]
    before = (await sql("SELECT headers FROM plugins"))[0][0][0]["value_enc"]
    r = await c.patch(f"/api/plugins/{p['id']}", json={
        "headers": [{"name": "authorization", "value": None}, {"name": "X-New", "value": "n"}], "enabled": False, "description": None,
    })
    assert r.status_code == 200
    q = r.json()["plugin"]
    assert [h["name"] for h in q["headers"]] == ["authorization", "X-New"] and q["enabled"] is False and q["description"] is None
    stored = (await sql("SELECT headers FROM plugins"))[0][0]
    assert stored[0]["value_enc"] == before and secrets.decrypt(stored[1]["value_enc"]) == "n"
    # omitting headers leaves them alone; an explicit new value replaces
    await c.patch(f"/api/plugins/{p['id']}", json={"name": "Renamed"})
    assert len((await sql("SELECT headers FROM plugins"))[0][0]) == 2
    await c.patch(f"/api/plugins/{p['id']}", json={"headers": [{"name": "Authorization", "value": "new"}]})
    assert secrets.decrypt((await sql("SELECT headers FROM plugins"))[0][0][0]["value_enc"]) == "new"
    assert (await c.patch(f"/api/plugins/{p['id']}", json={"url": "https://u:p@x.test"})).status_code == 422
    assert (await c.patch(f"/api/plugins/{p['id']}", json={"headers": [{"name": "Nope", "value": None}]})).status_code == 422


async def test_secrets_never_logged(make_client, caplog):
    import logging

    caplog.set_level(logging.DEBUG)
    c, _ = await active_client(make_client)
    await c.post("/api/plugins", json=BODY)
    await c.get("/api/plugins")
    assert "TOP-SECRET-TOKEN" not in caplog.text


async def test_no_key_configured(make_client, settings, monkeypatch):
    c, _ = await active_client(make_client)
    monkeypatch.setattr(settings, "secrets_key", "")
    r = await c.post("/api/plugins", json=BODY)
    assert r.status_code == 503 and r.json()["error"]["code"] == "secrets_not_configured"
    ok = await c.post("/api/plugins", json={**BODY, "headers": []})  # no secrets to store: fine
    assert ok.status_code == 201 and (await c.get("/api/plugins")).status_code == 200


async def _insert_plugin(user_id, headers_json="[]"):
    await sql(
        "INSERT INTO plugins (id, user_id, name, transport, url, headers)"
        " VALUES (gen_random_uuid(), :u, :n, 'http', 'https://x.test', CAST(:h AS jsonb))",
        u=user_id, n=f"p{uuid.uuid4().hex[:6]}", h=headers_json,
    )


async def test_startup_headerless_plugin_without_key_only_warns(settings, monkeypatch, caplog):
    from app.services.startup import check_secrets

    user = await create_user("a@example.com")
    monkeypatch.setattr(settings, "secrets_key", "")
    await _insert_plugin(user.id)  # header-less plugin created without a key
    await check_secrets()  # must not crash the next restart
    assert "SECRETS_KEY is not set" in caplog.text


async def test_startup_invalid_key_without_encrypted_data_warns_accurately(settings, monkeypatch, caplog):
    from app.services.startup import check_secrets

    monkeypatch.setattr(settings, "secrets_key", "not-a-fernet-key")
    await check_secrets()
    assert "not a valid Fernet key" in caplog.text and "Plugins are in use" not in caplog.text


async def test_startup_encrypted_plugin_without_key_fails_clearly(settings, monkeypatch):
    from app.services.startup import check_secrets

    user = await create_user("a@example.com")
    enc = secrets.encrypt("Bearer x")
    await _insert_plugin(user.id, json.dumps([{"name": "Authorization", "value_enc": enc}]))
    await check_secrets()  # right key: fine
    monkeypatch.setattr(settings, "secrets_key", "")
    with pytest.raises(RuntimeError, match="encrypted header values but SECRETS_KEY is not set"):
        await check_secrets()
    monkeypatch.setattr(settings, "secrets_key", "garbage")
    with pytest.raises(RuntimeError, match="not a valid Fernet key"):
        await check_secrets()


async def test_startup_wrong_key_with_encrypted_data_fails_clearly(settings, monkeypatch):
    from cryptography.fernet import Fernet

    from app.services.startup import check_secrets

    user = await create_user("a@example.com")
    await _insert_plugin(user.id, json.dumps([{"name": "Authorization", "value_enc": secrets.encrypt("Bearer x")}]))
    monkeypatch.setattr(settings, "secrets_key", Fernet.generate_key().decode())
    with pytest.raises(RuntimeError, match="cannot decrypt"):
        await check_secrets()


def mcp(servers) -> bytes:
    return json.dumps({"mcpServers": servers}).encode()


async def test_import_mcp_json(make_client):
    c, _ = await active_client(make_client)
    await c.post("/api/plugins", json={**BODY, "name": "existing"})
    data = mcp({
        "docs": {"type": "http", "url": "https://docs.example.com/mcp", "headers": {"Authorization": "Bearer abc123"}},
        "events": {"type": "sse", "url": "https://events.example.com/sse"},
        "bare": {"url": "https://bare.example.com/mcp"},
        "local-tool": {"command": "npx", "args": ["-y", "server"]},
        "existing": {"url": "https://x.example.com"},
        "creds": {"url": "https://u:p@x.example.com"},
        "weird/name": {"url": "https://w.example.com"},
        "broken": "nope",
    })
    r = await c.post("/api/plugins/import", files={"file": (".mcp.json", data)})
    assert r.status_code == 200
    body = r.json()
    names = {p["name"]: p for p in body["created"]}
    assert set(names) == {"docs", "events", "bare", "weird-name"}
    assert names["events"]["transport"] == "sse" and names["bare"]["transport"] == "http"
    assert names["docs"]["headers"] == [{"name": "Authorization", "value_masked": "••••••••"}]
    skipped = {s["name"]: s["reason"] for s in body["skipped"]}
    assert set(skipped) == {"local-tool", "existing", "creds", "broken"}
    assert "abc123" not in r.text
    raw = json.dumps((await sql("SELECT headers FROM plugins WHERE name = 'docs'"))[0][0])
    assert "abc123" not in raw


@pytest.mark.parametrize("data", [b"[" * 100000, b'{"mcpServers": ' + b"[" * 100000, b"not json", b"[]", b'{"mcpServers": []}', b"{}", json.dumps({"mcpServers": {f"s{i}": {"url": "https://x.test"} for i in range(51)}}).encode()])
async def test_import_invalid_files(make_client, data):
    c, _ = await active_client(make_client)
    r = await c.post("/api/plugins/import", files={"file": ("m.json", data)})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_plugin"


async def test_no_outbound_connections(make_client, monkeypatch):
    """Plugin URLs are stored only: creating/importing/listing must never open a socket (SSRF)."""
    import socket

    c, _ = await active_client(make_client)

    def boom(*a, **k):
        raise AssertionError("outbound connection attempted")

    monkeypatch.setattr(socket, "getaddrinfo", boom)
    monkeypatch.setattr(socket.socket, "connect", boom)
    r = await c.post("/api/plugins", json={**BODY, "url": "http://169.254.169.254/latest/meta-data"})
    assert r.status_code == 201
    await c.post("/api/plugins/import", files={"file": ("m.json", mcp({"x": {"url": "http://localhost:9999"}}))})
    assert (await c.get("/api/plugins")).status_code == 200


async def test_ownership_404(make_client):
    a, _ = await active_client(make_client)
    b, _ = await active_client(make_client)
    pid = (await a.post("/api/plugins", json=BODY)).json()["plugin"]["id"]
    assert (await b.get("/api/plugins")).json() == {"items": []}
    for r in (await b.patch(f"/api/plugins/{pid}", json={"enabled": False}), await b.delete(f"/api/plugins/{pid}")):
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


async def test_pending_403_and_unauth_401(make_client):
    await create_user("p@example.com", status="pending")
    c = make_client()
    await login(c, "p@example.com")
    pid = str(uuid.uuid4())
    for r in (
        await c.get("/api/plugins"), await c.post("/api/plugins", json=BODY), await c.patch(f"/api/plugins/{pid}", json={}),
        await c.delete(f"/api/plugins/{pid}"), await c.post("/api/plugins/import", files={"file": ("m.json", b"{}")}),
    ):
        assert r.status_code == 403 and r.json()["error"]["code"] == "account_pending"
    assert (await make_client().get("/api/plugins")).status_code == 401

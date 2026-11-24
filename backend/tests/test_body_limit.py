from tests.conftest import PASSWORD, create_user, login


def _json_blob(n: int) -> bytes:
    return b'{"email":"a@example.com","password":"' + b"x" * n + b'"}'


async def test_declared_oversize_json_rejected_with_413(client):
    r = await client.post("/api/auth/login", content=_json_blob(2 * 1024 * 1024), headers={"Content-Type": "application/json"})
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "request_too_large"
    assert r.headers["x-content-type-options"] == "nosniff"


async def test_streamed_oversize_without_content_length_rejected(client):
    async def chunks():
        for _ in range(3):
            yield b"x" * (512 * 1024)

    r = await client.post("/api/auth/login", content=chunks(), headers={"Content-Type": "application/json"})
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "request_too_large"


async def test_normal_json_still_works(client):
    await create_user("a@example.com")
    assert (await login(client, "a@example.com")).status_code == 200


async def test_upload_endpoint_has_its_own_cap(client, settings, monkeypatch):
    await create_user("a@example.com")
    await login(client, "a@example.com")
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    # a 3 MiB body is fine for the outer guard (uploads are only capped at MAX_UPLOAD_MB + overhead) ...
    r = await client.post("/api/files", files={"file": ("big.bin", b"x" * (3 * 1024 * 1024))})
    assert r.status_code == 413 and r.json()["error"]["code"] == "file_too_large"  # ... the handler's own exact limit
    # ... and an absurd declared length is stopped before the app reads anything
    r = await client.post("/api/files", content=b"x", headers={"Content-Length": str(100 * 1024 * 1024)})
    assert r.status_code == 413 and r.json()["error"]["code"] == "request_too_large"


async def test_credential_fields_are_length_bounded(client):
    long_email = "a" * 250 + "@example.com"
    assert (await client.post("/api/auth/login", json={"email": long_email, "password": "x"})).status_code == 422
    assert (await client.post("/api/auth/login", json={"email": "a@example.com", "password": "x" * 1025})).status_code == 422
    r = await client.post("/api/auth/register", json={"email": "a@example.com", "password": PASSWORD, "display_name": "n" * 81})
    assert r.status_code == 422
    r = await client.post("/api/auth/register", json={"email": "a@example.com", "password": "x" * 1025, "display_name": "n"})
    assert r.status_code == 422

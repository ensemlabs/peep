import gzip

import httpx2 as httpx
import pytest
from fastapi import FastAPI

from app.errors import register_error_handlers
from app.middleware import CSP, BodyLimitMiddleware, SecurityHeadersMiddleware
from app.spa import mount_spa

CACHE_ASSET = "public, max-age=31536000, immutable"


@pytest.fixture
def spa_client(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>shell</html>")
    (tmp_path / "manifest.webmanifest").write_text("{}")
    (tmp_path / "favicon.svg").write_text("<svg/>")
    (tmp_path / "assets" / "app-abc.js").write_text("console.log(1)")
    (tmp_path / "assets" / "app-abc.js.gz").write_bytes(gzip.compress(b"console.log(1)"))
    (tmp_path.parent / "secret.txt").write_text("outside")

    app = FastAPI()
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    register_error_handlers(app)

    @app.get("/api/ping")
    async def ping():
        return {"ok": True}

    assert mount_spa(app, tmp_path)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _secure(r):
    assert r.headers["content-security-policy"] == CSP
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "same-origin"


@pytest.mark.parametrize("path", ["/", "/index.html", "/c/123", "/admin/users", "/settings/integrations"])
async def test_shell_and_spa_routes(spa_client, path):
    r = await spa_client.get(path)
    assert r.status_code == 200 and r.text == "<html>shell</html>"
    assert r.headers["cache-control"] == "no-cache"
    assert r.headers["content-type"].startswith("text/html")
    _secure(r)


async def test_manifest_and_root_files(spa_client):
    r = await spa_client.get("/manifest.webmanifest")
    assert r.headers["content-type"].startswith("application/manifest+json")
    assert r.headers["cache-control"] == "no-cache"
    r = await spa_client.get("/favicon.svg")
    assert r.text == "<svg/>" and r.headers["content-type"].startswith("image/svg+xml")


async def test_assets_immutable_and_never_fall_back(spa_client):
    r = await spa_client.get("/assets/app-abc.js")
    assert r.status_code == 200 and r.headers["cache-control"] == CACHE_ASSET
    _secure(r)
    r = await spa_client.get("/assets/missing.js")
    assert r.status_code == 404 and "shell" not in r.text
    _secure(r)


async def test_gzip_served_only_when_accepted(spa_client):
    r = await spa_client.get("/assets/app-abc.js", headers={"Accept-Encoding": "gzip"})
    assert r.headers["content-encoding"] == "gzip" and r.text == "console.log(1)"
    assert r.headers["content-type"].startswith(("text/javascript", "application/javascript"))
    r = await spa_client.get("/assets/app-abc.js", headers={"Accept-Encoding": "identity"})
    assert "content-encoding" not in r.headers and r.text == "console.log(1)"


async def test_api_unknown_is_json_404_and_known_routes_work(spa_client):
    r = await spa_client.get("/api/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    _secure(r)
    assert (await spa_client.post("/api/nope")).status_code == 404
    assert (await spa_client.post("/api/ping")).status_code == 405
    r = await spa_client.get("/api/ping")
    assert r.json() == {"ok": True}
    _secure(r)


@pytest.mark.parametrize("path", ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt", "/assets/%00"])
async def test_no_path_traversal(spa_client, path):
    r = await spa_client.get(path)
    assert "outside" not in r.text


async def test_post_to_spa_path_is_404(spa_client):
    assert (await spa_client.post("/c/1")).status_code == 404


async def test_oversized_content_length_rejected(spa_client):
    r = await spa_client.post("/api/ping", content=b"x", headers={"Content-Length": str(50 * 1024 * 1024)})
    assert r.status_code == 413
    _secure(r)


async def test_no_build_means_api_only(tmp_path):
    assert mount_spa(FastAPI(), tmp_path / "missing") is False

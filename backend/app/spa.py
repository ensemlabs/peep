"""Serves the built SPA (same behaviour the nginx container had): immutable /assets, no-cache shell, SPA fallback."""

import logging
import mimetypes
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response
from starlette.types import Receive, Scope, Send

log = logging.getLogger(__name__)

_IMMUTABLE = "public, max-age=31536000, immutable"
_NO_CACHE = "no-cache"
# Pre-compressed at image build time (.gz next to the file); same set nginx gzipped, plus the HTML shell.
_GZIP_SUFFIXES = {".js", ".css", ".json", ".svg", ".html"}
_MEDIA_TYPES = {".webmanifest": "application/manifest+json"}


def _file_response(request: Request, path: Path, cache: str) -> Response:
    headers = {"Cache-Control": cache}
    media_type = _MEDIA_TYPES.get(path.suffix)
    gz = path.with_name(path.name + ".gz")
    if (
        path.suffix in _GZIP_SUFFIXES
        and "range" not in request.headers
        and "gzip" in request.headers.get("accept-encoding", "").lower()
        and gz.is_file()
    ):
        headers["Content-Encoding"] = "gzip"
        headers["Vary"] = "Accept-Encoding"
        return FileResponse(gz, media_type=media_type or _guess(path), headers=headers)
    if path.suffix in _GZIP_SUFFIXES:
        headers["Vary"] = "Accept-Encoding"
    return FileResponse(path, media_type=media_type, headers=headers)


def _guess(path: Path) -> str:
    return _MEDIA_TYPES.get(path.suffix) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def mount_spa(app: FastAPI, root: Path) -> bool:
    """Serve the SPA for every GET/HEAD the API routes did not match. Returns False if there is no build to serve.

    Hooks the router's "no route matched" fallback instead of adding a catch-all route, so a wrong method on a real
    API route is still 405 and an unknown /api path is still the API's JSON 404.
    """
    root = root.resolve()
    index = root / "index.html"
    if not index.is_file():
        log.info("no SPA build at %s: serving the API only", root)
        return False

    def inside(p: Path) -> bool:
        try:
            return p.is_file() and p.resolve().is_relative_to(root)
        except (OSError, ValueError):  # e.g. a NUL byte in the path
            return False

    api_not_found = app.router.default

    async def spa(scope: Scope, receive: Receive, send: Send) -> None:
        path = scope["path"].lstrip("/") if scope["type"] == "http" else "api/"
        if scope["type"] != "http" or scope["method"] not in ("GET", "HEAD") or path == "api" or path.startswith("api/"):
            await api_not_found(scope, receive, send)
            return
        request = Request(scope, receive)
        target = root / path
        if path.startswith("assets/"):
            # Never fall back to the shell: a missing hashed asset must be a real 404.
            if not inside(target):
                await api_not_found(scope, receive, send)
                return
            response = _file_response(request, target, _IMMUTABLE)
        elif path and path != "index.html" and inside(target):
            # Other real files (favicon, theme-init.js, icons, manifest) are revalidated like nginx's `location /`.
            response = _file_response(request, target, _NO_CACHE)
        else:
            response = _file_response(request, index, _NO_CACHE)
        await response(scope, receive, send)

    app.router.default = spa
    return True

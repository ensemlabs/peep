from urllib.parse import urlsplit

from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import get_settings
from app.errors import error_response

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_EXEMPT_PATHS = {"/api/health"}


def _origin_of(url: str) -> str | None:
    parts = urlsplit(url)
    if not parts.scheme or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}".lower()


class OriginCheckMiddleware:
    """CSRF defence: state-changing /api requests must come from an allowed Origin (or Referer)."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope["path"]
        if scope["method"] in _SAFE_METHODS or not path.startswith("/api/") or path in _EXEMPT_PATHS:
            await self.app(scope, receive, send)
            return

        headers = {k.lower(): v for k, v in scope["headers"]}
        origin = headers.get(b"origin", b"").decode("latin-1")
        if origin:
            candidate = origin.rstrip("/").lower()
        else:
            candidate = _origin_of(headers.get(b"referer", b"").decode("latin-1")) or ""
        if candidate not in get_settings().origins:
            response = error_response(403, "bad_origin", "Request origin is not allowed")
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)

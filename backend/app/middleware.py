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


CSP = (
    "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; "
    "form-action 'self'"
)
_SECURITY_HEADERS = [
    (b"content-security-policy", CSP.encode()),
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"same-origin"),
]
# Endpoints that read a multipart upload and enforce their own (larger) limits while streaming.
_UPLOAD_PATHS = {"/api/files", "/api/skills", "/api/plugins/import"}
JSON_BODY_LIMIT = 1024 * 1024
# Slack above MAX_UPLOAD_MB for multipart framing (nginx used 220 for 200).
_BODY_OVERHEAD = 20 * 1024 * 1024


class SecurityHeadersMiddleware:
    """Adds the security headers to every response (pure ASGI, so streaming/SSE is never buffered)."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                names = {k.lower() for k, _ in message["headers"]}
                message["headers"] = [*message["headers"], *(h for h in _SECURITY_HEADERS if h[0] not in names)]
            await send(message)

        await self.app(scope, receive, send_with_headers)


class _BodyTooLarge(Exception):
    pass


class BodyLimitMiddleware:
    """Caps request bodies (nginx's client_max_body_size is gone): 1 MiB for /api, uploads get MAX_UPLOAD_MB.

    Checks the declared Content-Length first, then counts streamed bytes so chunked bodies cannot slip through.
    The upload endpoints enforce their exact limits themselves; here they only get a coarse outer cap.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope["path"] if scope["type"] == "http" else ""
        if not (path == "/api" or path.startswith("/api/")):
            await self.app(scope, receive, send)
            return
        limit = JSON_BODY_LIMIT
        if scope["method"] == "POST" and path.rstrip("/") in _UPLOAD_PATHS:
            limit = get_settings().max_upload_bytes + _BODY_OVERHEAD
        for k, v in scope["headers"]:
            if k == b"content-length":
                if v.isdigit() and int(v) > limit:
                    await self._reject(scope, receive, send)
                    return
                break

        received = 0
        started = False  # the app began its own response
        rejected = False  # we answered 413 ourselves

        async def counting_receive():
            nonlocal received, rejected
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit and not started:
                    # Answer here: the framework would turn an exception raised from receive() into a 400.
                    rejected = True
                    await self._reject(scope, receive, send)
                    raise _BodyTooLarge
            return message

        async def tracking_send(message):
            nonlocal started
            if rejected:
                return  # the 413 is already out; drop whatever the aborted handler tries to send
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except _BodyTooLarge:
            pass

    @staticmethod
    async def _reject(scope: Scope, receive: Receive, send: Send) -> None:
        response = error_response(413, "request_too_large", "Request body is too large")
        await response(scope, receive, send)

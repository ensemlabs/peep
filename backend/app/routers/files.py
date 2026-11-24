import asyncio
import hashlib
import logging
import re
import uuid
from tempfile import SpooledTemporaryFile
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request, Response
from python_multipart.multipart import MultipartParser, parse_options_header
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from app.config import get_settings
from app.db import get_db
from app.deps import active_user
from app.errors import ApiError
from app.models import Conversation, File, User
from app.services import media, storage

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/files", tags=["files"])

SPOOL_MAX = 1024 * 1024
FORM_FIELD_MAX = 4096
MULTIPART_OVERHEAD = 1024 * 1024


# --- upload -----------------------------------------------------------------------------------


def _mb(n: int) -> str:
    return f"{n / 1024 / 1024:g} MB"


class _Upload:
    def __init__(self) -> None:
        self.fields: dict[str, str] = {}
        self.file: SpooledTemporaryFile | None = None
        self.filename: str | None = None
        self.mime: str | None = None
        self.size = 0
        self.sha = hashlib.sha256()

    def close(self) -> None:
        if self.file is not None:
            self.file.close()


async def read_upload(request: Request, max_bytes: int) -> _Upload:
    """Stream the multipart body into a spooled temp file, enforcing the size limit as it arrives."""
    ctype = request.headers.get("content-type", "")
    disposition, params = parse_options_header(ctype)
    if disposition != b"multipart/form-data" or b"boundary" not in params:
        raise ApiError(422, "invalid_request", "Expected multipart/form-data with a file")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > max_bytes + MULTIPART_OVERHEAD:
        raise ApiError(413, "file_too_large", f"File exceeds {_mb(max_bytes)}")

    up = _Upload()
    state: dict = {"headers": [], "name": b"", "value": b"", "part": None, "buf": bytearray()}
    pending: list[bytes] = []

    def on_part_begin() -> None:
        state.update(headers=[], name=b"", value=b"", part=None, buf=bytearray())

    def on_header_field(data: bytes, start: int, end: int) -> None:
        state["name"] += data[start:end]

    def on_header_value(data: bytes, start: int, end: int) -> None:
        state["value"] += data[start:end]

    def on_header_end() -> None:
        state["headers"].append((state["name"].lower(), state["value"]))
        state["name"] = b""
        state["value"] = b""

    def on_headers_finished() -> None:
        hdrs = dict(state["headers"])
        _, opts = parse_options_header(hdrs.get(b"content-disposition", b""))
        name = opts.get(b"name", b"").decode("utf-8", "replace")
        filename = opts.get(b"filename")
        if name == "file" and filename is not None and up.file is None:
            up.file = SpooledTemporaryFile(max_size=SPOOL_MAX)
            up.filename = filename.decode("utf-8", "replace")
            up.mime = hdrs.get(b"content-type", b"").decode("latin-1") or None
            state["part"] = "file"
        elif filename is None:
            state["part"] = name
        else:
            state["part"] = None  # extra files are drained and ignored

    def on_part_data(data: bytes, start: int, end: int) -> None:
        chunk = data[start:end]
        if state["part"] == "file":
            up.size += len(chunk)
            if up.size > max_bytes:
                raise ApiError(413, "file_too_large", f"File exceeds {_mb(max_bytes)}")
            up.sha.update(chunk)
            pending.append(chunk)
        elif state["part"]:
            if len(state["buf"]) + len(chunk) > FORM_FIELD_MAX:
                raise ApiError(422, "invalid_request", "Form field too large")
            state["buf"] += chunk

    def on_part_end() -> None:
        if state["part"] and state["part"] != "file":
            up.fields[state["part"]] = state["buf"].decode("utf-8", "replace")

    parser = MultipartParser(
        params[b"boundary"],
        {
            "on_part_begin": on_part_begin,
            "on_header_field": on_header_field,
            "on_header_value": on_header_value,
            "on_header_end": on_header_end,
            "on_headers_finished": on_headers_finished,
            "on_part_data": on_part_data,
            "on_part_end": on_part_end,
        },
    )
    try:
        async for chunk in request.stream():
            parser.write(chunk)
            if pending and up.file is not None:
                data = b"".join(pending)
                pending.clear()
                await asyncio.to_thread(up.file.write, data)
        parser.finalize()
    except ApiError:
        up.close()
        raise
    except Exception:
        up.close()
        raise ApiError(422, "invalid_request", "Malformed multipart body") from None
    return up


@router.post("", status_code=201)
async def upload_file(request: Request, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)):
    up = await read_upload(request, get_settings().max_upload_bytes)
    try:
        if up.file is None:
            raise ApiError(422, "invalid_request", "Missing 'file' part")
        if not (up.filename or "").strip():
            raise ApiError(415, "unsupported_type", "A filename is required")
        if up.size == 0:
            raise ApiError(422, "empty_file", "The file is empty")
        conversation_id = None
        raw_conv = up.fields.get("conversation_id", "").strip()
        if raw_conv:
            try:
                conversation_id = uuid.UUID(raw_conv)
            except ValueError:
                raise ApiError(422, "invalid_request", "conversation_id must be a UUID") from None
            conv = await db.get(Conversation, conversation_id)
            if conv is None or conv.user_id != user.id:
                raise ApiError(404, "not_found", "Conversation not found")
        row = await media.ingest(
            db,
            user_id=user.id,
            fp=up.file,
            size=up.size,
            filename=up.filename,
            mime=up.mime,
            conversation_id=conversation_id,
            sha256=up.sha.hexdigest(),
        )
    finally:
        up.close()
    return {"file": media.file_meta(row)}


# --- delete -----------------------------------------------------------------------------------


@router.delete("/{file_id}", status_code=204)
async def delete_file(
    file_id: uuid.UUID, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)
) -> Response:
    """Remove an unsent upload (e.g. the user dropped the attachment chip). Sent or generated files stay."""
    f = await db.get(File, file_id)
    if f is None or f.user_id != user.id:
        raise ApiError(404, "not_found", "File not found")
    if f.message_id is not None or f.source != "upload":
        raise ApiError(409, "file_in_use", "This file is attached to a message and cannot be deleted")
    keys = [k for k in (f.object_key, f.thumb_key) if k]
    await db.delete(f)
    await db.commit()
    try:
        await storage.delete_keys(keys)  # after the DB commit: a failure only leaves orphan objects
    except Exception:
        log.warning("could not delete objects of file %s", file_id, exc_info=True)
    return Response(status_code=204)


# --- download ---------------------------------------------------------------------------------


def parse_range(header: str | None, size: int) -> tuple[str, int, int]:
    """Return ("full"|"partial"|"unsatisfiable", start, end) for a Range header (end inclusive).

    Multi-range and malformed headers are ignored (full response), as RFC 9110 allows.
    """
    full = ("full", 0, size - 1)
    if not header:
        return full
    m = re.fullmatch(r"\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*", header)
    if not m or (not m.group(1) and not m.group(2)):
        return full
    first, last = m.groups()
    if not first:  # suffix range: last n bytes
        n = int(last)
        if n == 0 or size == 0:
            return ("unsatisfiable", 0, 0)
        return ("partial", max(0, size - n), size - 1)
    start = int(first)
    end = int(last) if last else size - 1
    if last and end < start:
        return full
    if start >= size:
        return ("unsatisfiable", 0, 0)
    return ("partial", start, min(end, size - 1))


def content_disposition(kind: str, filename: str, *, force_download: bool, inline_ok: bool) -> str:
    inline = inline_ok and not force_download and kind in media.INLINE_KINDS
    ascii_name = re.sub(r'[^\x20-\x7e]|["\\]', "_", filename)
    return (
        f"{'inline' if inline else 'attachment'}; filename=\"{ascii_name}\"; "
        f"filename*=UTF-8''{quote(filename, safe='')}"
    )


async def _owned_file(db: AsyncSession, user: User, file_id: uuid.UUID) -> File:
    f = await db.get(File, file_id)
    if f is None or f.user_id != user.id:
        raise ApiError(404, "not_found", "File not found")
    await db.commit()  # release the connection before streaming
    return f


def _common_headers(f: File, content_type: str) -> dict[str, str]:
    return {
        "Content-Type": content_type,
        "Accept-Ranges": "bytes",
        "ETag": f'"{f.sha256}"',
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
    }


@router.get("/{file_id}/content")
async def file_content(
    file_id: uuid.UUID,
    request: Request,
    download: int = 0,
    user: User = Depends(active_user),
    db: AsyncSession = Depends(get_db),
):
    f = await _owned_file(db, user, file_id)
    # Only verified media keeps its type; every other file is opaque bytes whatever the client claimed on upload.
    served_type = f.mime if f.kind in ("image", "video", "audio") else "application/octet-stream"
    headers = _common_headers(f, served_type)
    headers["Content-Disposition"] = content_disposition(
        f.kind, f.filename, force_download=bool(download), inline_ok=True
    )
    if request.headers.get("if-none-match") in (headers["ETag"], "*"):
        return Response(status_code=304, headers={k: v for k, v in headers.items() if k != "Content-Type"})

    kind, start, end = parse_range(request.headers.get("range"), f.size)
    if kind == "unsatisfiable":
        headers["Content-Range"] = f"bytes */{f.size}"
        return Response(status_code=416, headers=headers)
    try:
        body = await storage.get_range(f.object_key, start, end) if kind == "partial" else await storage.get_range(f.object_key)
    except Exception:
        raise ApiError(404, "not_found", "File content is unavailable") from None
    headers["Content-Length"] = str(end - start + 1)
    status = 200
    if kind == "partial":
        status = 206
        headers["Content-Range"] = f"bytes {start}-{end}/{f.size}"
    return StreamingResponse(storage.iter_body(body), status_code=status, headers=headers)


@router.get("/{file_id}/thumb")
async def file_thumb(file_id: uuid.UUID, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)):
    f = await _owned_file(db, user, file_id)
    if f.kind != "image" or not f.thumb_key:
        raise ApiError(404, "not_found", "No thumbnail")
    try:
        body = await storage.get_range(f.thumb_key)
    except Exception:
        raise ApiError(404, "not_found", "No thumbnail") from None
    headers = _common_headers(f, "image/webp")
    headers["ETag"] = f'"{f.sha256}-thumb"'
    headers["Content-Disposition"] = "inline"
    return StreamingResponse(storage.iter_body(body), headers=headers)

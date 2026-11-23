"""File ingestion: kind detection, image verification, thumbnails, FileMeta."""

import asyncio
import hashlib
import io
import logging
import mimetypes
import re
import uuid
import warnings
from typing import BinaryIO

from PIL import Image, ImageOps
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import File
from app.services import storage

Image.MAX_IMAGE_PIXELS = 100_000_000
THUMB_MAX = 768

VIDEO_EXT = {"mp4", "webm", "mov", "mkv", "ogv", "m4v"}
AUDIO_EXT = {"mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba", "webm"}
IMAGE_EXT = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "avif"}
# Anything a browser could execute/render as a document is stored as an opaque download.
UNSAFE_MIMES = {
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
    "text/xml",
    "application/xml",
    "text/javascript",
    "application/javascript",
    "application/x-javascript",
}
log = logging.getLogger(__name__)
INLINE_KINDS = {"image", "video", "audio"}
PIL_MIMES = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "GIF": "image/gif",
    "WEBP": "image/webp",
    "BMP": "image/bmp",
    "TIFF": "image/tiff",
    "AVIF": "image/avif",
}
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_MIME_RE = re.compile(r"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$")


def sanitize_filename(name: str | None) -> str:
    name = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = _CONTROL.sub("", name).strip().lstrip(".").strip()
    if not name:
        return "file"
    if len(name) > 200:
        stem, dot, ext = name.rpartition(".")
        if dot and 0 < len(ext) <= 20:
            name = stem[: 200 - len(ext) - 1] + "." + ext
        else:
            name = name[:200]
    return name


def _ext(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def _clean_mime(mime: str | None, filename: str) -> str:
    m = (mime or "").split(";")[0].strip().lower()
    if not _MIME_RE.match(m) or m == "application/octet-stream":
        m = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return m


def _probe_image(fp: BinaryIO) -> tuple[str, int, int] | None:
    """Return (mime, width, height) if fp is a real raster image within the pixel cap."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            fp.seek(0)
            with Image.open(fp) as im:
                fmt = im.format
                im.verify()
            fp.seek(0)
            with Image.open(fp) as im:
                width, height = im.size
        mime = PIL_MIMES.get(fmt or "")
        return (mime, width, height) if mime else None
    except Exception:
        return None


def _make_thumb(fp: BinaryIO) -> bytes | None:
    try:
        fp.seek(0)
        with Image.open(fp) as im:
            im = ImageOps.exif_transpose(im)
            im.thumbnail((THUMB_MAX, THUMB_MAX))
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGBA" if "A" in im.getbands() or "transparency" in im.info else "RGB")
            out = io.BytesIO()
            im.save(out, "WEBP", quality=80)
            return out.getvalue()
    except Exception:
        return None


def classify(fp: BinaryIO, filename: str, client_mime: str | None) -> dict:
    """Blocking: decide kind/mime and probe images. Returns kind, mime, width, height."""
    ext = _ext(filename)
    mime = _clean_mime(client_mime, filename)
    if mime not in UNSAFE_MIMES and (ext in IMAGE_EXT or mime.startswith("image/")) and ext != "svg":
        probed = _probe_image(fp)
        if probed:
            return {"kind": "image", "mime": probed[0], "width": probed[1], "height": probed[2]}
    if mime in UNSAFE_MIMES or ext in {"svg", "html", "htm", "xhtml"}:
        return {"kind": "file", "mime": "application/octet-stream", "width": None, "height": None}
    if mime.startswith("video/") and ext in VIDEO_EXT:
        return {"kind": "video", "mime": mime, "width": None, "height": None}
    if mime.startswith("audio/") and ext in AUDIO_EXT:
        return {"kind": "audio", "mime": mime, "width": None, "height": None}
    if mime.startswith(("image/", "video/", "audio/")):
        mime = "application/octet-stream"  # claims media but is not verifiable: no inline rendering
    return {"kind": "file", "mime": mime, "width": None, "height": None}


def _sha256(fp: BinaryIO) -> str:
    fp.seek(0)
    h = hashlib.sha256()
    while chunk := fp.read(1024 * 1024):
        h.update(chunk)
    return h.hexdigest()


async def ingest(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    fp: BinaryIO,
    size: int,
    filename: str | None,
    mime: str | None,
    source: str = "upload",
    conversation_id: uuid.UUID | None = None,
    message_id: uuid.UUID | None = None,
    sha256: str | None = None,
) -> File:
    """Classify, upload to S3 (and a thumbnail for images), and insert the files row (committed)."""
    filename = sanitize_filename(filename)
    info = await asyncio.to_thread(classify, fp, filename, mime)
    file_id = uuid.uuid4()
    digest = sha256 or await asyncio.to_thread(_sha256, fp)
    object_key = f"u/{user_id}/{file_id}/{filename}"
    thumb_key = None
    thumb: bytes | None = None
    if info["kind"] == "image":
        thumb = await asyncio.to_thread(_make_thumb, fp)
        if thumb:
            thumb_key = f"thumbs/{file_id}.webp"
    fp.seek(0)
    await storage.put_object(object_key, fp, info["mime"])
    if thumb and thumb_key:
        await storage.put_object(thumb_key, thumb, "image/webp")
    row = File(
        id=file_id,
        user_id=user_id,
        conversation_id=conversation_id,
        message_id=message_id,
        kind=info["kind"],
        mime=info["mime"],
        filename=filename,
        size=size,
        width=info["width"],
        height=info["height"],
        sha256=digest,
        object_key=object_key,
        thumb_key=thumb_key,
        source=source,
    )
    db.add(row)
    await db.commit()
    return row


def file_meta(f: File) -> dict:
    meta = {
        "id": str(f.id),
        "kind": f.kind,
        "mime": f.mime,
        "filename": f.filename,
        "size": f.size,
        "url": f"/api/files/{f.id}/content",
        "download_url": f"/api/files/{f.id}/content?download=1",
    }
    if f.width is not None:
        meta["width"] = f.width
    if f.height is not None:
        meta["height"] = f.height
    if f.thumb_key:
        meta["thumb_url"] = f"/api/files/{f.id}/thumb"
    return meta


async def delete_files(db: AsyncSession, files: list[File]) -> None:
    """Best-effort delete objects, then the rows (caller commits)."""
    keys = [k for f in files for k in (f.object_key, f.thumb_key) if k]
    try:
        await storage.delete_keys(keys)
    except Exception:
        log.exception("failed to delete %d objects", len(keys))
    for f in files:
        await db.delete(f)


async def delete_conversation_files(db: AsyncSession, conversation_id: uuid.UUID) -> None:
    rows = (await db.execute(select(File).where(File.conversation_id == conversation_id))).scalars().all()
    await delete_files(db, list(rows))

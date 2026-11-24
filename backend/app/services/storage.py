import asyncio
import logging
import time
import uuid
from collections.abc import AsyncIterator
from functools import cache
from typing import Any, BinaryIO

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import iterate_in_threadpool

from app.config import get_settings
from app.db import get_sessionmaker
from app.models import File

log = logging.getLogger(__name__)

STREAM_CHUNK = 64 * 1024


@cache
def s3_client():
    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.s3_endpoint,
        aws_access_key_id=s.s3_access_key,
        aws_secret_access_key=s.s3_secret_key,
        region_name="us-east-1",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, retries={"max_attempts": 2}),
    )


def _bucket() -> str:
    return get_settings().s3_bucket


def _ensure_bucket_once() -> None:
    client = s3_client()
    try:
        client.head_bucket(Bucket=_bucket())
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") not in ("404", "NoSuchBucket", "NotFound"):
            raise
        client.create_bucket(Bucket=_bucket())
        log.info("created bucket %s", _bucket())


async def ensure_bucket() -> None:
    """Create the bucket if missing, retrying with backoff while MinIO starts."""
    timeout = get_settings().s3_startup_timeout_seconds
    deadline = time.monotonic() + timeout
    delay = 0.5
    while True:
        try:
            await asyncio.to_thread(_ensure_bucket_once)
            return
        except (BotoCoreError, ClientError) as e:
            if time.monotonic() + delay > deadline:
                raise
            log.warning("S3 not ready (%s), retrying in %.1fs", type(e).__name__, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 5)


async def put_object(key: str, data: bytes | BinaryIO, mime: str) -> None:
    """Upload bytes or a file object. File objects go through boto3's managed (multipart) transfer."""
    extra = {"ContentType": mime}
    if isinstance(data, bytes):
        await asyncio.to_thread(s3_client().put_object, Bucket=_bucket(), Key=key, Body=data, **extra)
    else:
        await asyncio.to_thread(s3_client().upload_fileobj, data, _bucket(), key, ExtraArgs=extra)


async def head(key: str) -> dict[str, Any] | None:
    try:
        r = await asyncio.to_thread(s3_client().head_object, Bucket=_bucket(), Key=key)
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return None
        raise
    return {"size": r["ContentLength"], "etag": r.get("ETag"), "content_type": r.get("ContentType")}


async def get_range(key: str, start: int | None = None, end: int | None = None):
    """Return the boto3 StreamingBody for the (inclusive) byte range; the whole object if no range."""
    kwargs: dict[str, Any] = {}
    if start is not None:
        kwargs["Range"] = f"bytes={start}-{'' if end is None else end}"
    r = await asyncio.to_thread(s3_client().get_object, Bucket=_bucket(), Key=key, **kwargs)
    return r["Body"]


async def iter_body(body, chunk: int = STREAM_CHUNK) -> AsyncIterator[bytes]:
    """Stream a boto3 body without blocking the event loop; always closes it."""
    try:
        async for part in iterate_in_threadpool(body.iter_chunks(chunk)):
            yield part
    finally:
        await asyncio.to_thread(body.close)


async def get_bytes(key: str) -> bytes:
    body = await get_range(key)
    try:
        return await asyncio.to_thread(body.read)
    finally:
        await asyncio.to_thread(body.close)


def _delete_keys_sync(keys: list[str]) -> None:
    client = s3_client()
    for i in range(0, len(keys), 1000):
        batch = keys[i : i + 1000]
        client.delete_objects(Bucket=_bucket(), Delete={"Objects": [{"Key": k} for k in batch], "Quiet": True})


async def delete_keys(keys: list[str]) -> None:
    keys = [k for k in keys if k]
    if keys:
        await asyncio.to_thread(_delete_keys_sync, keys)


def _delete_prefix_sync(prefix: str) -> None:
    keys: list[str] = []
    for page in s3_client().get_paginator("list_objects_v2").paginate(Bucket=_bucket(), Prefix=prefix):
        keys.extend(o["Key"] for o in page.get("Contents", []))
    _delete_keys_sync(keys)


async def delete_prefix(prefix: str) -> None:
    await asyncio.to_thread(_delete_prefix_sync, prefix)


async def user_thumb_keys(db: AsyncSession, user_id: uuid.UUID) -> list[str]:
    return list((await db.execute(select(File.thumb_key).where(File.user_id == user_id, File.thumb_key.is_not(None)))).scalars())


async def delete_user_objects(user_id: uuid.UUID, thumbs: list[str] | None = None) -> None:
    """Delete every stored object (files under u/<user>/ and their thumbnails) owned by the user.

    Pass `thumbs` (from user_thumb_keys) when the file rows are already gone.
    """
    if thumbs is None:
        async with get_sessionmaker()() as db:
            thumbs = await user_thumb_keys(db, user_id)
    await delete_keys(thumbs)
    await delete_prefix(f"u/{user_id}/")

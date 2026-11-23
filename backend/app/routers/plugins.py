"""MCP server registrations. Stored only: the backend never connects to these URLs (no SSRF surface)."""

import asyncio
import json
import re
import uuid
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import active_user
from app.errors import ApiError
from app.models import Plugin, User
from app.routers.files import read_upload
from app.schemas import iso
from app.services import secrets

router = APIRouter(prefix="/api/plugins", tags=["plugins"])

MASK = "••••••••"
NAME_RE = re.compile(r"^[A-Za-z0-9 _-]{1,64}$")
HEADER_NAME_RE = re.compile(r"^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,64}$")  # RFC 9110 token
MAX_HEADERS = 20
MAX_PLUGINS = 100
MAX_URL = 2048
MAX_HEADER_VALUE = 4096
MAX_IMPORT_BYTES = 1024 * 1024
MAX_IMPORT_SERVERS = 50


class HeaderIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    value: str | None = None


class PluginIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    description: str | None = None
    transport: Literal["http", "sse"]
    url: str
    headers: list[HeaderIn] = []


class PluginPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str | None = None
    description: str | None = None
    transport: Literal["http", "sse"] | None = None
    url: str | None = None
    headers: list[HeaderIn] | None = None
    enabled: bool | None = None


def plugin_json(p: Plugin) -> dict:
    return {
        "id": str(p.id),
        "name": p.name,
        "description": p.description,
        "transport": p.transport,
        "url": p.url,
        "headers": [{"name": h["name"], "value_masked": MASK} for h in p.headers or []],
        "enabled": p.enabled,
        "created_at": iso(p.created_at),
        "updated_at": iso(p.updated_at),
    }


def bad(msg: str) -> ApiError:
    return ApiError(422, "invalid_plugin", msg)


def validate_name(name: str) -> str:
    name = name.strip()
    if not NAME_RE.match(name):
        raise bad("name must be 1-64 characters: letters, digits, space, '_' or '-'")
    return name


def validate_url(url: str) -> str:
    url = url.strip()
    if not url or len(url) > MAX_URL or re.search(r"\s", url):
        raise bad("url is missing, too long or contains whitespace")
    try:
        parts = urlsplit(url)
        _ = parts.port
    except ValueError:
        raise bad("url is not valid") from None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise bad("url must be an http(s) URL")
    if parts.username is not None or parts.password is not None:
        raise bad("url must not contain credentials; use a header instead")
    return url


def validate_header_value(v: str) -> str:
    if len(v) > MAX_HEADER_VALUE or re.search(r"[\x00-\x08\x0a-\x1f\x7f]", v):
        raise bad("header value is too long or contains control characters")
    return v


def build_headers(items: list[HeaderIn], existing: list[dict[str, Any]] | None = None) -> list[dict[str, str]]:
    """Encrypt header values. A null value keeps the stored value of the same header name."""
    if len(items) > MAX_HEADERS:
        raise bad(f"at most {MAX_HEADERS} headers")
    old = {h["name"].lower(): h["value_enc"] for h in existing or []}
    seen: set[str] = set()
    out = []
    for h in items:
        name = h.name.strip()
        if not HEADER_NAME_RE.match(name):
            raise bad(f"invalid header name {name!r}")
        if name.lower() in seen:
            raise bad(f"duplicate header {name!r}")
        seen.add(name.lower())
        if h.value is None:
            if name.lower() not in old:
                raise bad(f"header {name!r} has no stored value to keep")
            out.append({"name": name, "value_enc": old[name.lower()]})
        else:
            out.append({"name": name, "value_enc": secrets.encrypt(validate_header_value(h.value))})
    return out


async def _owned(db: AsyncSession, user: User, plugin_id: uuid.UUID) -> Plugin:
    p = await db.get(Plugin, plugin_id)
    if p is None or p.user_id != user.id:
        raise ApiError(404, "not_found", "Plugin not found")
    return p


async def _count(db: AsyncSession, user: User) -> int:
    return (await db.execute(select(func.count()).select_from(Plugin).where(Plugin.user_id == user.id))).scalar_one()


@router.get("")
async def list_plugins(user: User = Depends(active_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Plugin).where(Plugin.user_id == user.id).order_by(func.lower(Plugin.name)))).scalars()
    return {"items": [plugin_json(p) for p in rows]}


@router.post("", status_code=201)
async def create_plugin(body: PluginIn, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)):
    if await _count(db, user) >= MAX_PLUGINS:
        raise ApiError(422, "too_many_plugins", f"At most {MAX_PLUGINS} plugins")
    desc = (body.description or "").strip()[:500] or None
    plugin = Plugin(
        user_id=user.id,
        name=validate_name(body.name),
        description=desc,
        transport=body.transport,
        url=validate_url(body.url),
        headers=build_headers(body.headers),
    )
    db.add(plugin)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ApiError(409, "plugin_exists", "A plugin with this name already exists") from None
    return {"plugin": plugin_json(plugin)}


@router.post("/import")
async def import_plugins(request: Request, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)):
    up = await read_upload(request, MAX_IMPORT_BYTES)
    try:
        if up.file is None:
            raise ApiError(422, "invalid_request", "Missing 'file' part")
        up.file.seek(0)
        raw = await asyncio.to_thread(up.file.read)
    finally:
        up.close()
    try:
        servers = json.loads(raw.decode("utf-8")).get("mcpServers")
    except (UnicodeDecodeError, ValueError, AttributeError, RecursionError):
        raise bad("not a valid .mcp.json file") from None
    if not isinstance(servers, dict):
        raise bad("expected a top-level 'mcpServers' object")
    if len(servers) > MAX_IMPORT_SERVERS:
        raise bad(f"at most {MAX_IMPORT_SERVERS} servers per import")

    existing = {
        n.lower() for n in (await db.execute(select(Plugin.name).where(Plugin.user_id == user.id))).scalars()
    }
    count = len(existing)
    created: list[Plugin] = []
    skipped: list[dict[str, str]] = []
    for raw_name, cfg in servers.items():
        name = re.sub(r"[^A-Za-z0-9 _-]", "-", str(raw_name)).strip()[:64]
        if not isinstance(cfg, dict) or not name:
            skipped.append({"name": str(raw_name)[:64], "reason": "invalid entry"})
            continue
        if "url" not in cfg:
            skipped.append({"name": name, "reason": "only http/sse servers with a url are supported"})
            continue
        kind = str(cfg.get("type") or cfg.get("transport") or "http").lower()
        transport = "sse" if kind == "sse" else "http"
        if name.lower() in existing:
            skipped.append({"name": name, "reason": "a plugin with this name already exists"})
            continue
        if count + len(created) >= MAX_PLUGINS:
            skipped.append({"name": name, "reason": "plugin limit reached"})
            continue
        try:
            hdrs = cfg.get("headers") or {}
            if not isinstance(hdrs, dict):
                raise bad("headers must be an object")
            plugin = Plugin(
                user_id=user.id,
                name=validate_name(name),
                description=None,
                transport=transport,
                url=validate_url(str(cfg["url"])),
                headers=build_headers([HeaderIn(name=str(k), value=str(v)) for k, v in hdrs.items()]),
            )
        except ApiError as e:
            if e.status == 503:
                raise
            skipped.append({"name": name, "reason": e.message})
            continue
        existing.add(name.lower())
        created.append(plugin)
    db.add_all(created)
    await db.commit()
    return {"created": [plugin_json(p) for p in created], "skipped": skipped}


@router.patch("/{plugin_id}")
async def patch_plugin(
    plugin_id: uuid.UUID, body: PluginPatch, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)
):
    p = await _owned(db, user, plugin_id)
    if body.name is not None:
        p.name = validate_name(body.name)
    if "description" in body.model_fields_set:
        p.description = (body.description or "").strip()[:500] or None
    if body.transport is not None:
        p.transport = body.transport
    if body.url is not None:
        p.url = validate_url(body.url)
    if body.headers is not None:
        p.headers = build_headers(body.headers, p.headers)
    if body.enabled is not None:
        p.enabled = body.enabled
    p.updated_at = datetime.now(UTC)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ApiError(409, "plugin_exists", "A plugin with this name already exists") from None
    return {"plugin": plugin_json(p)}


@router.delete("/{plugin_id}", status_code=204)
async def delete_plugin(
    plugin_id: uuid.UUID, user: User = Depends(active_user), db: AsyncSession = Depends(get_db)
) -> Response:
    p = await _owned(db, user, plugin_id)
    await db.delete(p)
    await db.commit()
    return Response(status_code=204)

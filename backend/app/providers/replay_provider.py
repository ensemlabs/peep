"""Replays recorded event streams (fixtures) so the UI can show what real models cannot produce."""

import asyncio
import copy
import mimetypes
from functools import cache
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, model_validator

from app.config import get_settings
from app.providers.base import ProviderError, RunContext

REPLAY_DIR = Path(__file__).resolve().parent.parent / "replay"
FIXTURES_DIR = REPLAY_DIR / "fixtures"
ASSETS_DIR = REPLAY_DIR / "assets"
ASSET_PREFIX = "asset:"
PART_TYPES = {"thinking", "text", "tool", "subagent", "files"}


class Step(BaseModel):
    model_config = ConfigDict(extra="forbid")

    after_ms: int = 0
    op: Literal["part", "delta", "update"]
    parent: str | None = None
    part: dict[str, Any] | None = None
    part_id: str | None = None
    field: Literal["text", "output"] | None = None
    text: str | None = None
    patch: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _check(self) -> "Step":
        if self.after_ms < 0:
            raise ValueError("after_ms must be >= 0")
        if self.op == "part":
            if not self.part or not self.part.get("id") or self.part.get("type") not in PART_TYPES:
                raise ValueError("op 'part' needs a part with id and a valid type")
        elif self.op == "delta":
            if not (self.part_id and self.field and self.text is not None):
                raise ValueError("op 'delta' needs part_id, field and text")
        elif not (self.part_id and self.patch):
            raise ValueError("op 'update' needs part_id and patch")
        return self


class Fixture(BaseModel):
    model_config = ConfigDict(extra="forbid")

    steps: list[Step]
    error: str | None = None  # if set, the run ends with this error after the last step

    @model_validator(mode="after")
    def _check_refs(self) -> "Fixture":
        known: set[str] = set()
        for i, step in enumerate(self.steps):
            if step.op == "part":
                assert step.part is not None
                if step.parent is not None and step.parent not in known:
                    raise ValueError(f"step {i}: unknown parent {step.parent!r}")
                known.add(step.part["id"])
            else:
                if step.part_id not in known:
                    raise ValueError(f"step {i}: unknown part_id {step.part_id!r}")
            for ref in _asset_refs(step.part) + _asset_refs(step.patch):
                if not (ASSETS_DIR / ref).is_file():
                    raise ValueError(f"step {i}: missing asset {ref!r}")
        return self


def _asset_refs(obj: dict[str, Any] | None) -> list[str]:
    if not obj:
        return []
    return [f[len(ASSET_PREFIX) :] for f in obj.get("files", []) if isinstance(f, str) and f.startswith(ASSET_PREFIX)]


def list_fixture_names() -> list[str]:
    return sorted(p.stem for p in FIXTURES_DIR.glob("*.json"))


@cache
def load_fixture(name: str) -> Fixture:
    path = FIXTURES_DIR / f"{name}.json"
    if "/" in name or "\\" in name or not path.is_file():
        raise ProviderError(f"Unknown replay fixture {name!r}")
    return Fixture.model_validate_json(path.read_text(encoding="utf-8"))


class ReplayProvider:
    async def run(self, ctx: RunContext) -> None:
        fixture = load_fixture(ctx.model.removeprefix("replay:"))
        scale = get_settings().replay_time_scale
        stored: dict[str, dict[str, Any]] = {}

        async def resolve(obj: dict[str, Any] | None) -> dict[str, Any] | None:
            if obj is None:
                return None
            obj = copy.deepcopy(obj)
            if "files" in obj:
                files = []
                for f in obj["files"]:
                    if isinstance(f, str) and f.startswith(ASSET_PREFIX):
                        name = f[len(ASSET_PREFIX) :]
                        if name not in stored:
                            mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
                            stored[name] = await ctx.store_file((ASSETS_DIR / name).read_bytes(), mime, name)
                        f = stored[name]
                    files.append(f)
                obj["files"] = files
            return obj

        for step in fixture.steps:
            if step.after_ms and scale > 0:
                await asyncio.sleep(step.after_ms / 1000 * scale)
            if step.op == "part":
                part = await resolve(step.part)
                assert part is not None
                await ctx.emit_part(part, step.parent)
            elif step.op == "delta":
                assert step.part_id and step.field and step.text is not None
                await ctx.emit_delta(step.part_id, step.field, step.text)
            else:
                assert step.part_id
                patch = await resolve(step.patch)
                assert patch is not None
                await ctx.emit_update(step.part_id, patch)
        if fixture.error:
            raise ProviderError(fixture.error)

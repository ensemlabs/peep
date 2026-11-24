"""Model registry: config/models.yaml (or the LLM_* env fallback) + per-provider OpenAI clients."""

import copy
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import yaml
from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from app.config import get_settings

log = logging.getLogger(__name__)

Label = str | dict[str, str]
OFF = "off"
_ENV_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")

# Keys of a thinking-level patch that the OpenAI SDK accepts as real keyword arguments;
# everything else must travel in `extra_body`.
SDK_KWARGS = {
    "reasoning_effort", "temperature", "top_p", "max_tokens", "max_completion_tokens", "presence_penalty",
    "frequency_penalty", "seed", "stop", "verbosity", "service_tier", "response_format", "n", "logit_bias",
}


class ConfigError(Exception):
    """Invalid or unreadable models config. Raised at startup so the failure is obvious."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")



class ReadFrom(_Strict):
    delta_fields: list[str] = ["reasoning_content", "reasoning"]
    parse_tags: bool = False
    tag_names: list[str] = ["think", "thought"]


class Level(_Strict):
    id: str = Field(min_length=1, max_length=32)
    label: Label
    patch: dict[str, Any] = {}


class Thinking(_Strict):
    default: str | None = None
    returns_text: bool = True
    read_from: ReadFrom = ReadFrom()
    levels: list[Level] = Field(min_length=1)

    @model_validator(mode="after")
    def _check(self) -> "Thinking":
        ids = [lv.id for lv in self.levels]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate thinking level ids")
        if self.default is None:
            self.default = ids[0]
        elif self.default not in ids:
            raise ValueError(f"thinking.default {self.default!r} is not one of the levels {ids}")
        return self


class ModelCfg(_Strict):
    id: str = Field(min_length=1)
    upstream: str | None = None
    label: Label | None = None
    vision: bool = False
    context_window: int = Field(128_000, gt=0)
    image_tokens: int = Field(765, ge=0)
    token_ratio: float = Field(1.0, gt=0)
    thinking: Thinking | None = None


class ProviderCfg(_Strict):
    id: str = Field(min_length=1)
    base_url: str = Field(min_length=1)
    api_key_env: str | None = None
    usage: Literal["provider", "estimate"] = "provider"
    models: list[ModelCfg] = Field(min_length=1)


class Dev(_Strict):
    model_switcher: bool = False


class RegistryCfg(_Strict):
    active: str
    providers: list[ProviderCfg] = Field(min_length=1)
    dev: Dev = Dev()

    @field_validator("providers")
    @classmethod
    def _unique_ids(cls, v: list[ProviderCfg]) -> list[ProviderCfg]:
        ids = [m.id for p in v for m in p.models]
        dup = {i for i in ids if ids.count(i) > 1}
        if dup:
            raise ValueError(f"duplicate model ids: {sorted(dup)}")
        if len({p.id for p in v}) != len(v):
            raise ValueError("duplicate provider ids")
        return v

    @model_validator(mode="after")
    def _active_exists(self) -> "RegistryCfg":
        ids = {m.id for p in self.providers for m in p.models}
        if self.active.startswith("replay:"):
            from app.providers.replay_provider import list_fixture_names

            if self.active.removeprefix("replay:") not in list_fixture_names():
                raise ValueError(f"active replay model {self.active!r} has no fixture (have: {list_fixture_names()})")
        elif self.active not in ids:
            raise ValueError(f"active model {self.active!r} is not defined in providers")
        return self


@dataclass
class ResolvedModel:
    id: str
    upstream: str
    label: Label
    provider_id: str
    base_url: str
    api_key: str
    usage_mode: str
    cfg: ModelCfg

    def level(self, level_id: str | None) -> Level | None:
        if not self.cfg.thinking:
            return None
        wanted = level_id or self.cfg.thinking.default
        return next((lv for lv in self.cfg.thinking.levels if lv.id == wanted), None)


@dataclass
class Registry:
    active_id: str
    switchable: bool
    models: dict[str, ResolvedModel] = field(default_factory=dict)

    def get(self, model_id: str) -> ResolvedModel | None:
        return self.models.get(model_id)


# --- loading ----------------------------------------------------------------------------------


def _interpolate(obj: Any, env: dict[str, str]) -> Any:
    if isinstance(obj, str):

        def sub(m: re.Match) -> str:
            name, default = m.group(1), m.group(2)
            if env.get(name):
                return env[name]
            if default is not None:  # like compose: an empty variable counts as unset for ${VAR:-default}
                return default
            if name in env:
                return ""
            raise ConfigError(f"environment variable {name} is not set (used in models config)")

        return _ENV_RE.sub(sub, obj)
    if isinstance(obj, list):
        return [_interpolate(x, env) for x in obj]
    if isinstance(obj, dict):
        return {k: _interpolate(v, env) for k, v in obj.items()}
    return obj


def build_registry(raw: dict[str, Any], env: dict[str, str] | None = None) -> Registry:
    env = dict(os.environ) if env is None else env
    try:
        cfg = RegistryCfg.model_validate(_interpolate(raw, env))
    except ValidationError as e:
        raise ConfigError("invalid models config: " + "; ".join(
            f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in e.errors()
        )) from None
    reg = Registry(active_id=cfg.active, switchable=cfg.dev.model_switcher)
    for p in cfg.providers:
        key = env.get(p.api_key_env, "") if p.api_key_env else ""
        for m in p.models:
            reg.models[m.id] = ResolvedModel(
                id=m.id, upstream=m.upstream or m.id, label=m.label or pretty_label(m.id), provider_id=p.id,
                base_url=p.base_url, api_key=key, usage_mode=p.usage, cfg=m,
            )
    return reg


class _StrictBoolLoader(yaml.SafeLoader):
    """SafeLoader where only true/false are booleans: YAML 1.1's yes/no/on/off stay strings (`id: off`)."""


_StrictBoolLoader.yaml_implicit_resolvers = {
    k: [(tag, rx) for tag, rx in v if tag != "tag:yaml.org,2002:bool"]
    for k, v in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
_StrictBoolLoader.add_implicit_resolver(
    "tag:yaml.org,2002:bool", re.compile(r"^(?:true|True|TRUE|false|False|FALSE)$"), list("tTfF")
)


def parse_yaml(text: str) -> Any:
    return yaml.load(text, Loader=_StrictBoolLoader)  # noqa: S506 - SafeLoader subclass


def load_file(path: str) -> Registry:
    try:
        raw = parse_yaml(Path(path).read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        raise ConfigError(f"{path}: invalid YAML: {e}") from None
    if not isinstance(raw, dict):
        raise ConfigError(f"{path}: expected a mapping at the top level")
    return build_registry(raw)


def gemini_levels() -> dict[str, Any]:
    return {
        "default": OFF,
        "returns_text": True,
        "read_from": {"delta_fields": ["reasoning_content", "reasoning"], "parse_tags": False},
        "levels": [
            {"id": OFF, "label": {"en": "Off", "vi": "Tắt"}, "patch": {}},
            {"id": "high", "label": {"en": "High", "vi": "Cao"}, "patch": {"reasoning_effort": "high"}},
        ],
    }


def fallback_registry() -> Registry:
    """Backward-compatible registry built from LLM_* env settings ."""
    s = get_settings()
    if not s.llm_base_url or not s.llm_default_model:
        raise ConfigError(
            f"No models config at {s.models_config} and LLM_BASE_URL / LLM_DEFAULT_MODEL are not set. "
            "Copy config/models.example.yaml to config/models.yaml, or set the LLM_* variables."
        )
    ids = list(dict.fromkeys([s.llm_default_model, *s.llm_model_allowlist]))
    raw = {
        "active": s.llm_default_model,
        "dev": {"model_switcher": s.dev_model_switcher},
        "providers": [
            {
                "id": "default",
                "base_url": s.llm_base_url,
                "usage": "estimate",
                "models": [
                    {"id": i, "vision": True, "context_window": 1_000_000, "image_tokens": 258, "thinking": gemini_levels()}
                    for i in ids
                ],
            }
        ],
    }
    reg = build_registry(raw, env={})
    for m in reg.models.values():
        m.api_key = s.llm_api_key
    return reg


_cached: Registry | None = None


def reset() -> None:
    global _cached
    _cached = None


def get_registry() -> Registry:
    """File-based registries are loaded once; the env fallback is rebuilt (cheap) so settings stay live."""
    global _cached
    if _cached is not None:
        return _cached
    path = get_settings().models_config
    if path and Path(path).is_file():
        _cached = load_file(path)
        log.info("loaded model registry from %s (active=%s)", path, _cached.active_id)
        return _cached
    return fallback_registry()


def pretty_label(model_id: str) -> str:
    return " ".join(w.capitalize() for w in model_id.replace("_", "-").split("-") if w)


def pick_label(label: Label, lang: str) -> str:
    if isinstance(label, str):
        return label
    return label.get(lang) or label.get("en") or next(iter(label.values()), "")


def lang_from_header(accept_language: str | None) -> str:
    first = (accept_language or "").split(",")[0].strip().lower()
    return "vi" if first.startswith("vi") else "en"


# --- request building -------------------------------------------------------------------------


def deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def build_request_params(base: dict[str, Any], patch: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Merge a level patch into the request. Returns (sdk kwargs, extra_body).

    `patch.extra_body` goes into extra_body untouched; other patch keys are deep-merged into the request and
    sent as SDK kwargs when the SDK knows them, else via extra_body.
    """
    patch = copy.deepcopy(patch)
    extra = patch.pop("extra_body", {}) or {}
    merged = deep_merge(base, patch)
    kwargs: dict[str, Any] = {}
    for k, v in merged.items():
        if k in SDK_KWARGS or k in base:
            kwargs[k] = v
        else:
            extra = deep_merge(extra, {k: v})
    return kwargs, extra


# --- clients ----------------------------------------------------------------------------------

_clients: dict[tuple[str, str, float], AsyncOpenAI] = {}


def client_for(model: ResolvedModel) -> AsyncOpenAI:
    timeout = get_settings().llm_timeout_seconds
    key = (model.base_url, model.api_key, timeout)
    if key not in _clients:
        _clients[key] = AsyncOpenAI(
            base_url=model.base_url, api_key=model.api_key or "none", timeout=timeout, max_retries=0
        )
    return _clients[key]


async def close_clients() -> None:
    for c in list(_clients.values()):
        await c.close()
    _clients.clear()


# --- availability (registry + replay) ---------------------------------------------------------


def replay_model(name: str) -> ResolvedModel:
    mid = f"replay:{name}"
    return ResolvedModel(
        id=mid, upstream=mid, label=f"Replay · {name.replace('-', ' ').capitalize()}", provider_id="replay",
        base_url="", api_key="", usage_mode="estimate", cfg=ModelCfg(id=mid, context_window=128_000),
    )


def selectable(reg: Registry) -> dict[str, ResolvedModel]:
    """Models a user may use: only the active one, or everything (plus replay) when dev.model_switcher is on."""
    from app.providers.replay_provider import list_fixture_names

    s = get_settings()
    out: dict[str, ResolvedModel] = {}
    active = resolve(reg, reg.active_id)
    if active is not None:
        out[active.id] = active
    if reg.switchable:
        out.update(reg.models)
        if s.replay_enabled:
            out.update({m.id: m for m in (replay_model(n) for n in list_fixture_names())})
    return out


def resolve(reg: Registry, model_id: str) -> ResolvedModel | None:
    if model_id.startswith("replay:"):
        from app.providers.replay_provider import list_fixture_names

        name = model_id.removeprefix("replay:")
        return replay_model(name) if name in list_fixture_names() else None
    return reg.get(model_id)

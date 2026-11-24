import pytest

from app.services import model_registry as mr
from app.services.model_registry import ConfigError, build_registry, build_request_params, deep_merge
from tests.conftest import active_client

YAML = """
active: m1
providers:
  - id: p
    base_url: ${TEST_BASE:-http://default.test/v1}
    api_key_env: TEST_KEY
    usage: estimate
    models:
      - id: m1
        upstream: real-m1
        label: {en: Model One, vi: Mo Hinh Mot}
        vision: true
        context_window: 5000
        image_tokens: 100
        thinking:
          default: off
          read_from: {delta_fields: [reasoning], parse_tags: true, tag_names: [think]}
          levels:
            - {id: off, label: {en: Off, vi: Tat}, patch: {}}
            - {id: high, label: High, patch: {reasoning_effort: high, extra_body: {thinking: {type: enabled}}}}
      - id: plain
        label: Plain
"""


def test_load_interpolation_and_defaults(monkeypatch):
    monkeypatch.setenv("TEST_BASE", "http://from-env.test/v1")
    monkeypatch.setenv("TEST_KEY", "sekret")
    reg = build_registry(mr.parse_yaml(YAML))
    m = reg.get("m1")
    assert reg.active_id == "m1" and not reg.switchable
    assert (m.upstream, m.base_url, m.api_key, m.usage_mode) == ("real-m1", "http://from-env.test/v1", "sekret", "estimate")
    assert reg.get("plain").upstream == "plain" and reg.get("plain").cfg.thinking is None
    assert m.level(None).id == "off" and m.level("high").patch["reasoning_effort"] == "high" and m.level("zzz") is None


def test_interpolation_default_missing_and_empty(monkeypatch):
    monkeypatch.delenv("TEST_BASE", raising=False)
    assert build_registry(mr.parse_yaml(YAML)).get("m1").base_url == "http://default.test/v1"
    monkeypatch.setenv("TEST_BASE", "")  # empty counts as unset for :-default
    assert build_registry(mr.parse_yaml(YAML)).get("m1").base_url == "http://default.test/v1"
    raw = mr.parse_yaml(YAML.replace("${TEST_BASE:-http://default.test/v1}", "${TEST_REQUIRED_NOPE}"))
    with pytest.raises(ConfigError, match="TEST_REQUIRED_NOPE"):
        build_registry(raw)


@pytest.mark.parametrize(
    "mutate,match",
    [
        (lambda t: t.replace("active: m1", "active: nope"), "active model"),
        (lambda t: t.replace("id: plain", "id: m1"), "duplicate model ids"),
        (lambda t: t.replace("default: off", "default: ultra"), "thinking.default"),
        (lambda t: t.replace("{id: high, label: High", "{id: off, label: High"), "duplicate thinking level"),
        (lambda t: t.replace("vision: true", "vision: maybe"), "vision"),
        (lambda t: t.replace("context_window: 5000", "context_window: 0"), "context_window"),
        (lambda t: t.replace("usage: estimate", "usage: guess"), "usage"),
        (lambda t: t.replace("vision: true", "vison: true"), "vison"),
    ],
)
def test_validation_errors(mutate, match):
    with pytest.raises(ConfigError, match=match):
        build_registry(mr.parse_yaml(mutate(YAML)), env={})


def test_load_file_errors(tmp_path):
    bad = tmp_path / "bad.yaml"
    bad.write_text("a: [unclosed")
    with pytest.raises(ConfigError, match="invalid YAML"):
        mr.load_file(str(bad))
    bad.write_text("- just\n- a list\n")
    with pytest.raises(ConfigError, match="mapping"):
        mr.load_file(str(bad))


def test_fallback_registry_from_llm_env(settings, monkeypatch):
    monkeypatch.setattr(settings, "llm_default_model", "alpha")
    monkeypatch.setattr(settings, "llm_models", "beta,alpha")
    monkeypatch.setattr(settings, "llm_base_url", "http://x.test/v1")
    monkeypatch.setattr(settings, "llm_api_key", "k")
    reg = mr.get_registry()
    assert reg.active_id == "alpha" and list(reg.models) == ["alpha", "beta"]
    m = reg.get("alpha")
    assert m.usage_mode == "estimate" and m.api_key == "k" and m.base_url == "http://x.test/v1"
    assert [lv.id for lv in m.cfg.thinking.levels] == ["off", "high"] and m.level("high").patch == {"reasoning_effort": "high"}


def test_fallback_needs_configuration(settings, monkeypatch):
    monkeypatch.setattr(settings, "llm_base_url", "")
    with pytest.raises(ConfigError, match="LLM_BASE_URL"):
        mr.get_registry()


def test_file_registry_wins_and_is_cached(use_registry):
    reg = use_registry(YAML)
    assert reg.active_id == "m1" and mr.get_registry() is reg


# --- request building --------------------------------------------------------------------------


def test_deep_merge():
    base = {"a": {"x": 1, "y": {"z": 1}}, "b": 1}
    out = deep_merge(base, {"a": {"y": {"w": 2}}, "c": 3})
    assert out == {"a": {"x": 1, "y": {"z": 1, "w": 2}}, "b": 1, "c": 3}
    assert base == {"a": {"x": 1, "y": {"z": 1}}, "b": 1}  # inputs untouched


def test_patch_kwargs_vs_extra_body():
    base = {"model": "m", "messages": [], "stream": True, "stream_options": {"include_usage": True}}
    kwargs, extra = build_request_params(
        base, {"reasoning_effort": "high", "extra_body": {"thinking": {"type": "enabled"}}, "reasoning": {"effort": "low"}}
    )
    assert kwargs["reasoning_effort"] == "high" and kwargs["stream_options"] == {"include_usage": True}
    assert extra == {"thinking": {"type": "enabled"}, "reasoning": {"effort": "low"}}  # unknown top-level key -> extra_body
    assert "extra_body" not in kwargs


def test_patch_merges_into_existing_params():
    base = {"model": "m", "stream_options": {"include_usage": True}}
    kwargs, _ = build_request_params(base, {"stream_options": {"x": 1}})
    assert kwargs["stream_options"] == {"include_usage": True, "x": 1}


def test_build_request_applies_level_patch(use_registry):
    from app.providers.openai_provider import build_request

    reg = use_registry(YAML)
    m = reg.get("m1")
    off = build_request(m, [], "off")
    high = build_request(m, [], "high")
    assert off["model"] == "real-m1" and off["stream"] is True and "reasoning_effort" not in off and "extra_body" not in off
    assert off["stream_options"] == {"include_usage": True}
    assert high["reasoning_effort"] == "high" and high["extra_body"] == {"thinking": {"type": "enabled"}}
    # model without thinking: plain request
    assert "extra_body" not in build_request(reg.get("plain"), [], None)


def test_yaml_booleans_stay_strings():
    raw = mr.parse_yaml("a: [off, on, no, yes, No, Off, true, false, True]\nb: {id: no, label: No}")
    assert raw["a"] == ["off", "on", "no", "yes", "No", "Off", True, False, True]
    assert raw["b"] == {"id": "no", "label": "No"}


def test_levels_named_like_yaml_booleans():
    reg = build_registry(mr.parse_yaml("""
active: m
providers:
  - id: p
    base_url: http://x.test/v1
    models:
      - id: m
        thinking:
          default: off
          levels:
            - {id: off, label: {en: Off, vi: Tắt}, patch: {}}
            - {id: no, label: No, patch: {}}
            - {id: on, label: On, patch: {}}
"""), env={})
    th = reg.get("m").cfg.thinking
    assert [lv.id for lv in th.levels] == ["off", "no", "on"] and th.default == "off"
    assert [mr.pick_label(lv.label, "en") for lv in th.levels] == ["Off", "No", "On"]


def test_active_replay_must_exist():
    raw = mr.parse_yaml(YAML.replace("active: m1", "active: replay:nope"))
    with pytest.raises(ConfigError, match="replay model 'replay:nope' has no fixture"):
        build_registry(raw, env={})
    assert build_registry(mr.parse_yaml(YAML.replace("active: m1", "active: replay:agent-demo")), env={}).active_id == "replay:agent-demo"


def test_drop_params_key_is_gone():
    raw = mr.parse_yaml(YAML.replace("        context_window: 5000", "        drop_params_when_thinking: [temperature]\n        context_window: 5000"))
    with pytest.raises(ConfigError, match="drop_params_when_thinking"):
        build_registry(raw, env={})


# --- /api/models ---------------------------------------------------------------------------------


async def test_models_endpoint_labels_and_shape(make_client, use_registry):
    use_registry(YAML)
    c, _ = await active_client(make_client)
    r = await c.get("/api/models", headers={"Accept-Language": "vi-VN,vi;q=0.9"})
    body = r.json()
    assert body["switchable"] is False and body["items"] == [body["active"]]
    a = body["active"]
    assert a == {
        "id": "m1", "label": "Mo Hinh Mot", "provider": "p", "vision": True, "context_window": 5000,
        "image_tokens": 100,
        "reasoning": {
            "levels": [{"id": "off", "label": "Tat"}, {"id": "high", "label": "High"}], "default": "off", "returns_text": True,
        },
    }
    en = (await c.get("/api/models", headers={"Accept-Language": "en-US"})).json()["active"]
    assert en["label"] == "Model One" and en["reasoning"]["levels"][0]["label"] == "Off"
    assert (await c.get("/api/models")).json()["active"]["label"] == "Model One"


async def test_models_non_thinking_and_non_vision(make_client, use_registry):
    use_registry(YAML.replace("active: m1", "active: plain"))
    c, _ = await active_client(make_client)
    a = (await c.get("/api/models")).json()["active"]
    assert a["reasoning"] is None and a["image_tokens"] is None and a["label"] == "Plain"


async def test_models_switchable_lists_everything_and_replay(make_client, use_registry, settings, monkeypatch):
    use_registry(YAML.replace("active: m1", "dev:\n  model_switcher: true\nactive: m1"))
    c, _ = await active_client(make_client)
    body = (await c.get("/api/models")).json()
    assert body["switchable"] is True
    assert [m["id"] for m in body["items"]] == ["m1", "plain", "replay:agent-demo", "replay:code-demo", "replay:error-demo"]
    rp = body["items"][2]
    assert rp["provider"] == "replay" and rp["reasoning"] is None and rp["label"] == "Replay · Agent demo"
    monkeypatch.setattr(settings, "replay_enabled", False)
    assert [m["id"] for m in (await c.get("/api/models")).json()["items"]] == ["m1", "plain"]


async def test_replay_active_without_switcher(make_client, use_registry):
    use_registry(YAML.replace("active: m1", "active: replay:agent-demo"))
    c, _ = await active_client(make_client)
    body = (await c.get("/api/models")).json()
    assert body["active"]["id"] == "replay:agent-demo" and len(body["items"]) == 1


# --- level / model validation matrix --------------------------------------------------------------


async def _send(c, cid, **body):
    r = await c.post(f"/api/conversations/{cid}/messages", json={"content": "hi", **body})
    return r


async def test_level_validation_matrix(make_client, use_registry, settings, monkeypatch):
    use_registry(YAML.replace("active: m1", "active: replay:error-demo"))
    # replay model has no levels -> any reasoning value is ignored
    c, _ = await active_client(make_client)
    cid = (await c.post("/api/conversations", json={})).json()["conversation"]["id"]
    assert (await _send(c, cid, reasoning="whatever")).status_code == 200


async def test_levels_for_thinking_model(make_client, use_registry, settings, monkeypatch):
    from tests.test_providers import FakeOpenAI, chunk
    from tests.conftest import serve

    fake = FakeOpenAI(script=[chunk(content="ok")])
    async with serve(fake.app) as url:
        monkeypatch.setenv("TEST_BASE", url + "/v1")
        use_registry(YAML)
        c, _ = await active_client(make_client)
        cid = (await c.post("/api/conversations", json={})).json()["conversation"]["id"]
        r = await _send(c, cid, reasoning="ultra")
        assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_reasoning_level"
        r = await _send(c, cid, reasoning="on")
        assert r.status_code == 422  # no legacy aliasing: only declared levels
        assert (await _send(c, cid)).status_code == 200  # default level (off)
        assert "reasoning_effort" not in fake.requests[-1] and fake.requests[-1]["model"] == "real-m1"
        assert (await _send(c, cid, reasoning="high")).status_code == 200
        req = fake.requests[-1]
        assert req["reasoning_effort"] == "high" and req["thinking"] == {"type": "enabled"}  # extra_body merged into body
        assert req["stream_options"] == {"include_usage": True}


async def test_model_param_ignored_unless_switchable(make_client, use_registry):
    use_registry(YAML)
    c, _ = await active_client(make_client)
    cid = (await c.post("/api/conversations", json={"model": "replay:agent-demo"})).json()["conversation"]["id"]
    assert (await c.get(f"/api/conversations/{cid}")).json()["conversation"]["model"] == "m1"
    r = await _send(c, cid, model="replay:error-demo")
    assert r.status_code == 200 or r.status_code == 200
    from tests.conftest import parse_sse

    assert parse_sse(r.text)[0][1]["assistant_message"]["model"] == "m1"  # ignored, active model used


async def test_unknown_model_when_switchable(make_client, use_registry):
    use_registry(YAML.replace("active: m1", "dev:\n  model_switcher: true\nactive: m1"))
    c, _ = await active_client(make_client)
    cid = (await c.post("/api/conversations", json={})).json()["conversation"]["id"]
    r = await _send(c, cid, model="nope")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_model"

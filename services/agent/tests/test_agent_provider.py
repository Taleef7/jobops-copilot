"""get_model_for_agent: agent_configs resolution, caching, and env fallback.

The point of this function is that swapping a model is a database write, not a deploy —
so these tests pin the resolution order, the two caches (active row by TTL, model instance
by (agent, version)), and the rule that a config problem degrades to the env-based model
instead of taking the agent down.
"""

import pytest

from app.llm import provider
from app.llm.provider import AgentConfig, get_model_for_agent


@pytest.fixture(autouse=True)
def _clear_caches():
    provider._active_cache.clear()
    provider._model_cache.clear()
    yield
    provider._active_cache.clear()
    provider._model_cache.clear()


@pytest.fixture()
def env_model(monkeypatch):
    """Replace the env-based fallback with a recognizable sentinel."""
    sentinel = (object(), "anthropic:claude-sonnet-4-6")
    monkeypatch.setattr(provider, "get_model", lambda: sentinel)
    return sentinel


def _cfg(version=1, model="anthropic:claude-haiku-4-5", params=None):
    return AgentConfig("feed-curator", version, model, params or {}, {})


def test_unknown_agent_id_rejected():
    with pytest.raises(ValueError):
        get_model_for_agent("nope")


def test_resolves_from_the_active_row(monkeypatch):
    monkeypatch.setattr(provider, "_fetch_active_config", lambda a: _cfg())
    monkeypatch.setattr(provider.settings, "anthropic_api_key", "sk-test")

    chat, label, cfg = get_model_for_agent("feed-curator")

    assert chat is not None
    assert label == "anthropic:claude-haiku-4-5"
    assert cfg.version == 1


def test_row_params_reach_the_model(monkeypatch):
    captured = {}

    def fake_init(model, **kwargs):
        captured.update(kwargs)
        captured["model"] = model
        return object()

    monkeypatch.setattr(provider, "init_chat_model", fake_init)
    monkeypatch.setattr(provider.settings, "anthropic_api_key", "sk-test")
    monkeypatch.setattr(
        provider,
        "_fetch_active_config",
        lambda a: _cfg(params={"temperature": 0.9, "max_tokens": 1234, "nonsense": "drop me"}),
    )

    get_model_for_agent("feed-curator")

    assert captured["model"] == "anthropic:claude-haiku-4-5"
    assert captured["temperature"] == 0.9
    assert captured["max_tokens"] == 1234
    assert "nonsense" not in captured, "only known-safe params are forwarded"


def test_model_instance_cached_per_version(monkeypatch):
    calls = []
    monkeypatch.setattr(
        provider, "_fetch_active_config", lambda a: calls.append(a) or _cfg()
    )
    monkeypatch.setattr(provider.settings, "anthropic_api_key", "sk-test")

    chat1, _, _ = get_model_for_agent("feed-curator")
    chat2, _, _ = get_model_for_agent("feed-curator")

    assert chat1 is chat2, "same version must reuse the built client"
    assert len(calls) == 1, "the TTL cache must prevent a second database read"


def test_version_bump_rebuilds_the_model_and_evicts_the_old_one(monkeypatch):
    monkeypatch.setattr(provider.settings, "anthropic_api_key", "sk-test")
    monkeypatch.setattr(provider, "_fetch_active_config", lambda a: _cfg(version=1))
    chat1, _, _ = get_model_for_agent("feed-curator")

    provider._active_cache.clear()  # simulate TTL expiry after a PUT repoint
    monkeypatch.setattr(
        provider, "_fetch_active_config", lambda a: _cfg(version=2, model="openai:gpt-5.6-luna")
    )
    monkeypatch.setattr(provider.settings, "openai_api_key", "sk-test-oa")

    chat2, label2, cfg2 = get_model_for_agent("feed-curator")

    assert chat2 is not chat1
    assert label2 == "openai:gpt-5.6-luna"
    assert cfg2.version == 2
    assert ("feed-curator", 1) not in provider._model_cache


def test_falls_back_to_env_when_no_row(monkeypatch, env_model):
    monkeypatch.setattr(provider, "_fetch_active_config", lambda a: None)

    chat, label, cfg = get_model_for_agent("resume-tailor")

    assert chat is env_model[0]
    assert label == env_model[1]
    assert cfg is None


def test_falls_back_when_the_configured_provider_has_no_credentials(monkeypatch, env_model):
    monkeypatch.setattr(
        provider, "_fetch_active_config", lambda a: _cfg(model="openai:gpt-5.6-luna")
    )
    monkeypatch.setattr(provider.settings, "openai_api_key", None)

    chat, label, cfg = get_model_for_agent("feed-curator")

    assert chat is env_model[0]
    assert label == env_model[1], "the label must name the model actually used"
    assert cfg is None


def test_falls_back_on_an_unsupported_provider(monkeypatch, env_model):
    monkeypatch.setattr(provider, "_fetch_active_config", lambda a: _cfg(model="mystery:model-x"))

    chat, label, cfg = get_model_for_agent("feed-curator")

    assert chat is env_model[0]
    assert cfg is None


def test_a_database_outage_never_raises(monkeypatch, env_model):
    monkeypatch.setattr(provider.settings, "database_url", "postgresql://nope/nope")

    def explode(*_args, **_kwargs):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(provider, "_connect", explode)

    assert provider._fetch_active_config("feed-curator") is None
    chat, label, cfg = get_model_for_agent("feed-curator")
    assert chat is env_model[0]
    assert cfg is None


def test_no_database_url_short_circuits_before_connecting(monkeypatch):
    monkeypatch.setattr(provider.settings, "database_url", None)

    def explode(*_args, **_kwargs):  # pragma: no cover - must never run
        raise AssertionError("must not connect without DATABASE_URL")

    monkeypatch.setattr(provider, "_connect", explode)

    assert provider._fetch_active_config("feed-curator") is None

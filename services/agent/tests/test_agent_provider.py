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
    monkeypatch.setattr(provider, "_fetch_active_config", lambda a: calls.append(a) or _cfg())
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


@pytest.mark.parametrize(
    ("endpoint", "api_key"),
    [(None, "az-key"), ("https://example.openai.azure.com", None), (None, None)],
)
def test_azure_falls_back_unless_both_endpoint_and_key_are_set(
    monkeypatch, env_model, endpoint, api_key
):
    # api_version carries a non-empty default, so "any credential is set" is always true
    # for Azure — the required pair has to be checked explicitly, or a swap to azure_openai
    # on a deployment without Azure credentials fails every single call.
    monkeypatch.setattr(
        provider, "_fetch_active_config", lambda a: _cfg(model="azure_openai:gpt-4o-mini")
    )
    monkeypatch.setattr(provider.settings, "azure_openai_endpoint", endpoint)
    monkeypatch.setattr(provider.settings, "azure_openai_api_key", api_key)

    chat, label, cfg = get_model_for_agent("feed-curator")

    assert chat is env_model[0]
    assert label == env_model[1]
    assert cfg is None


def test_a_model_that_cannot_be_constructed_falls_back(monkeypatch, env_model):
    monkeypatch.setattr(provider.settings, "anthropic_api_key", "sk-test")
    monkeypatch.setattr(provider, "_fetch_active_config", lambda a: _cfg(model="anthropic:typo"))

    def explode(*_args, **_kwargs):
        raise ValueError("unknown model")

    monkeypatch.setattr(provider, "init_chat_model", explode)

    chat, label, cfg = get_model_for_agent("feed-curator")

    assert chat is env_model[0]
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


# --- #410: gpt-6-luna's call shape ----------------------------------------------------
#
# #329 switched to gpt-6-luna by changing only the model id, and every call failed for 6
# days: luna rejects temperature (and top_p), and with reasoning effort it takes function
# tools only through the Responses API. The call shape follows the model name, so setting
# OPENAI_MODEL alone can't bring that back, and every other model is sent what it was before.


def _capture(monkeypatch):
    captured = {}

    def fake_init(model, **kwargs):
        captured.clear()
        captured.update(kwargs)
        captured["model"] = model
        return object()

    monkeypatch.setattr(provider, "init_chat_model", fake_init)
    return captured


@pytest.fixture()
def openai_env(monkeypatch):
    monkeypatch.setattr(provider.settings, "llm_provider", "openai")
    monkeypatch.setattr(provider.settings, "openai_api_key", "sk-test-oa")
    provider.get_model.cache_clear()
    yield
    provider.get_model.cache_clear()


def test_luna_goes_through_the_responses_api_with_its_effort_and_no_sampling(
    monkeypatch, openai_env
):
    captured = _capture(monkeypatch)
    monkeypatch.setattr(provider.settings, "openai_model", "gpt-6-luna")
    monkeypatch.setattr(provider.settings, "openai_reasoning_effort", "medium")

    _, label = provider.get_model()

    assert label == "openai:gpt-6-luna"
    assert captured["model"] == "openai:gpt-6-luna"
    assert captured["use_responses_api"] is True
    # Chat Completions doesn't keep requests; the Responses API would by default.
    assert captured["store"] is False
    assert captured["reasoning_effort"] == "medium"
    assert "temperature" not in captured
    assert "top_p" not in captured
    assert captured["timeout"] == provider.settings.request_timeout


def test_luna_never_gets_a_temperature_even_without_an_effort(monkeypatch, openai_env):
    captured = _capture(monkeypatch)
    monkeypatch.setattr(provider.settings, "openai_model", "gpt-6-luna")
    monkeypatch.setattr(provider.settings, "openai_reasoning_effort", "")

    provider.get_model()

    assert "temperature" not in captured
    assert captured["use_responses_api"] is True
    assert "reasoning_effort" not in captured, "an empty effort leaves the provider's default"


@pytest.mark.parametrize("model", ["gpt-5.4-nano", "gpt-4o-mini"])
def test_other_openai_models_are_sent_what_they_were_before(monkeypatch, openai_env, model):
    # Rolling back to nano, and the evals on gpt-4o-mini, must not change by a single key.
    captured = _capture(monkeypatch)
    monkeypatch.setattr(provider.settings, "openai_model", model)
    monkeypatch.setattr(provider.settings, "openai_reasoning_effort", "medium")

    provider.get_model()

    assert captured == {
        "model": f"openai:{model}",
        "api_key": "sk-test-oa",
        "temperature": provider.settings.llm_temperature,
        "timeout": provider.settings.request_timeout,
    }


def test_a_luna_row_drops_sampling_params_and_keeps_the_rest(monkeypatch):
    captured = _capture(monkeypatch)
    monkeypatch.setattr(provider.settings, "openai_api_key", "sk-test-oa")
    monkeypatch.setattr(provider.settings, "openai_reasoning_effort", "medium")
    monkeypatch.setattr(
        provider,
        "_fetch_active_config",
        lambda a: _cfg(
            model="openai:gpt-6-luna",
            params={"temperature": 0.2, "top_p": 0.9, "max_tokens": 8192},
        ),
    )

    _, label, cfg = get_model_for_agent("feed-curator")

    assert label == "openai:gpt-6-luna"
    assert cfg is not None
    assert "temperature" not in captured
    assert "top_p" not in captured
    assert captured["max_tokens"] == 8192
    assert captured["use_responses_api"] is True
    assert captured["store"] is False
    assert captured["reasoning_effort"] == "medium"


def test_a_luna_row_can_set_its_own_effort(monkeypatch):
    captured = _capture(monkeypatch)
    monkeypatch.setattr(provider.settings, "openai_api_key", "sk-test-oa")
    monkeypatch.setattr(provider.settings, "openai_reasoning_effort", "medium")
    monkeypatch.setattr(
        provider,
        "_fetch_active_config",
        lambda a: _cfg(model="openai:gpt-6-luna", params={"reasoning_effort": "low"}),
    )

    get_model_for_agent("feed-curator")

    assert captured["reasoning_effort"] == "low"


def test_an_openai_row_for_another_model_keeps_its_temperature(monkeypatch):
    captured = _capture(monkeypatch)
    monkeypatch.setattr(provider.settings, "openai_api_key", "sk-test-oa")
    monkeypatch.setattr(
        provider,
        "_fetch_active_config",
        lambda a: _cfg(model="openai:gpt-5.6-luna", params={"top_p": 0.9}),
    )

    get_model_for_agent("feed-curator")

    assert captured["temperature"] == provider.settings.llm_temperature
    assert captured["top_p"] == 0.9
    assert "use_responses_api" not in captured

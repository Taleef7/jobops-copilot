"""Provider-resolution precedence tests."""

from app.config import Settings
from app.llm import provider as provider_module


def _resolve_with(monkeypatch, **overrides):
    monkeypatch.setattr(provider_module, "settings", Settings(**overrides))
    return provider_module.resolve_provider()


def test_no_credentials_returns_none(monkeypatch):
    assert _resolve_with(monkeypatch) is None
    monkeypatch.setattr(provider_module, "settings", Settings())
    assert provider_module.llm_available() is False


def test_explicit_provider_wins(monkeypatch):
    assert _resolve_with(monkeypatch, llm_provider="openai", anthropic_api_key="x") == "openai"


def test_implicit_anthropic_first(monkeypatch):
    assert _resolve_with(monkeypatch, anthropic_api_key="x", openai_api_key="y") == "anthropic"


def test_implicit_azure_requires_endpoint_and_key(monkeypatch):
    assert (
        _resolve_with(monkeypatch, azure_openai_api_key="k", azure_openai_endpoint="https://e")
        == "azure_openai"
    )
    # Key without endpoint should not select azure.
    assert _resolve_with(monkeypatch, azure_openai_api_key="k", openai_api_key="o") == "openai"

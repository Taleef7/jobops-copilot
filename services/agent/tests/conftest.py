"""Test fixtures. Tests run without provider credentials so they are CI-safe."""

import pytest

from app.config import settings


@pytest.fixture(autouse=True)
def _clear_llm_env(monkeypatch):
    for var in (
        "LLM_PROVIDER",
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_ENDPOINT",
        "GOOGLE_GEMINI_API_KEY",
    ):
        monkeypatch.delenv(var, raising=False)
    for attr in (
        "llm_provider",
        "anthropic_api_key",
        "openai_api_key",
        "azure_openai_api_key",
        "google_gemini_api_key",
    ):
        monkeypatch.setattr(settings, attr, None)
    # A model call a test forgot to fake goes nowhere instead of to a real provider.
    for var in ("OPENAI_BASE_URL", "ANTHROPIC_BASE_URL"):
        monkeypatch.setenv(var, "http://127.0.0.1:9")
    yield

"""Test fixtures. Tests run without provider credentials so they are CI-safe."""

import pytest


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
    yield

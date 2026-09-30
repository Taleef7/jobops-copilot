"""The canary's own model call (#348), against a fake with get_model()'s real shape.

The endpoint tests replace run_llm_canary; these exercise it, so a wrong call shape (a
local run against the live code path found `get_model()` used as a model when it returns
``(chat_model, label)``) fails here instead of on every scheduled run.
"""

import pytest

import app.llm.canary as canary


class _FakeStructured:
    def __init__(self, answer):
        self.answer = answer
        self.prompts: list[str] = []

    def invoke(self, prompt):
        self.prompts.append(prompt)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


class _FakeChat:
    def __init__(self, answer):
        self.structured = _FakeStructured(answer)
        self.schema = None

    def with_structured_output(self, schema):
        self.schema = schema
        return self.structured


def _use(monkeypatch, answer):
    chat = _FakeChat(answer)
    monkeypatch.setattr(canary, "get_model", lambda: (chat, "openai:gpt-5.4-nano"))
    return chat


def test_canary_parses_the_title_through_the_structured_model(monkeypatch):
    chat = _use(monkeypatch, canary._CanaryTitle(title="Senior Data Engineer"))

    canary.run_llm_canary()

    assert chat.schema is canary._CanaryTitle
    assert "Senior Data Engineer at Acme Corp" in chat.structured.prompts[0]


def test_canary_fails_on_an_empty_answer(monkeypatch):
    _use(monkeypatch, canary._CanaryTitle(title="  "))

    with pytest.raises(RuntimeError, match="no title"):
        canary.run_llm_canary()


def test_canary_passes_the_provider_error_through(monkeypatch):
    _use(monkeypatch, RuntimeError("Incorrect API key provided"))

    with pytest.raises(RuntimeError, match="Incorrect API key"):
        canary.run_llm_canary()

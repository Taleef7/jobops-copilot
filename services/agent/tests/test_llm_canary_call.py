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


class _FakeMessage:
    def __init__(self, tool_calls):
        self.tool_calls = tool_calls


_TOOL_CALL = [{"name": "_CanaryTitle", "args": {"title": "Senior Data Engineer"}, "id": "c1"}]


class _FakeChat:
    def __init__(self, answer, tool_answer=None):
        self.structured = _FakeStructured(answer)
        self.tooled = _FakeStructured(
            _FakeMessage(_TOOL_CALL) if tool_answer is None else tool_answer
        )
        self.schema = None
        self.tools = None
        self.tool_choice = None

    def with_structured_output(self, schema):
        self.schema = schema
        return self.structured

    def bind_tools(self, tools, tool_choice=None):
        self.tools = tools
        self.tool_choice = tool_choice
        return self.tooled


def _use(monkeypatch, answer, tool_answer=None):
    chat = _FakeChat(answer, tool_answer)
    monkeypatch.setattr(canary, "get_model", lambda: (chat, "openai:gpt-6-luna"))
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


# #410: tool calls take another route than structured output on gpt-6-luna. A canary that
# checks only structured output stays green while the assistant and every agent fail.


def test_canary_makes_a_forced_tool_call(monkeypatch):
    chat = _use(monkeypatch, canary._CanaryTitle(title="Senior Data Engineer"))

    canary.run_llm_canary()

    assert chat.tools == [canary._CanaryTitle]
    assert chat.tool_choice == "any"
    assert "Senior Data Engineer at Acme Corp" in chat.tooled.prompts[0]


def test_canary_fails_when_tools_are_refused_though_structured_output_works(monkeypatch):
    _use(
        monkeypatch,
        canary._CanaryTitle(title="Senior Data Engineer"),
        RuntimeError("Function tools with reasoning_effort are not supported for gpt-6-luna"),
    )

    with pytest.raises(RuntimeError, match="Function tools"):
        canary.run_llm_canary()


@pytest.mark.parametrize(
    "tool_calls",
    [[], [{"name": "_CanaryTitle", "args": {"title": " "}, "id": "c1"}]],
)
def test_canary_fails_when_no_tool_call_comes_back(monkeypatch, tool_calls):
    _use(monkeypatch, canary._CanaryTitle(title="Senior Data Engineer"), _FakeMessage(tool_calls))

    with pytest.raises(RuntimeError, match="no tool call"):
        canary.run_llm_canary()

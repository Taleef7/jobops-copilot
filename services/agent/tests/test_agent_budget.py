"""Behavioral tests for per-run agent token budget guards (#255)."""

import pytest
from langchain_core.messages import AIMessage

from app.config import settings


def test_token_budget_exceeded_attributes_and_message():
    from app.graph.budget import TokenBudgetExceeded

    exc = TokenBudgetExceeded("Budget exceeded", budget=1000, tokens_used=1500)
    assert isinstance(exc, Exception)
    assert exc.budget == 1000
    assert exc.tokens_used == 1500
    assert exc.used == 1500
    assert exc.code == "budget_exceeded"
    assert "Budget exceeded" in str(exc)


def test_token_budget_exceeded_default_code_and_message():
    from app.graph.budget import TokenBudgetExceeded

    exc = TokenBudgetExceeded(budget=2000, tokens_used=2500)
    assert exc.code == "budget_exceeded"
    assert exc.budget == 2000
    assert exc.tokens_used == 2500
    assert exc.used == 2500
    assert "budget exhausted" in str(exc).lower()


def test_usage_tokens_from_usage_metadata():
    from app.graph.budget import extract_tokens, usage_tokens

    msg = AIMessage(
        content="test response",
        usage_metadata={"total_tokens": 150, "input_tokens": 100, "output_tokens": 50},
    )
    assert usage_tokens(msg) == 150
    assert extract_tokens(msg) == 150


def test_usage_tokens_from_response_metadata_token_usage():
    from app.graph.budget import usage_tokens

    msg = AIMessage(
        content="test response",
        response_metadata={"token_usage": {"total_tokens": 230}},
    )
    assert usage_tokens(msg) == 230


def test_usage_tokens_from_response_metadata_usage_dict():
    from app.graph.budget import usage_tokens

    msg = AIMessage(
        content="test response",
        response_metadata={"usage": {"total_tokens": 340}},
    )
    assert usage_tokens(msg) == 340


def test_usage_tokens_fallback_summing_input_output():
    from app.graph.budget import usage_tokens

    class MessageWithMissingTotal:
        usage_metadata = {"input_tokens": 80, "output_tokens": 40}

    assert usage_tokens(MessageWithMissingTotal()) == 120


def test_usage_tokens_returns_zero_when_missing():
    from app.graph.budget import usage_tokens

    msg = AIMessage(content="no metadata")
    assert usage_tokens(msg) == 0
    assert usage_tokens(None) == 0
    assert usage_tokens("plain text") == 0


def test_check_budget_passes_within_limit():
    from app.graph.budget import check_budget

    check_budget(tokens_used=500, budget=1000)
    check_budget(tokens_used=1000, budget=1000)
    check_budget(tokens_used=9999, budget=None)


def test_check_budget_raises_when_exceeded():
    from app.graph.budget import TokenBudgetExceeded, check_budget

    with pytest.raises(TokenBudgetExceeded) as exc_info:
        check_budget(tokens_used=1001, budget=1000)

    assert exc_info.value.code == "budget_exceeded"
    assert exc_info.value.tokens_used == 1001
    assert exc_info.value.budget == 1000


def test_charge_tokens_accumulates_and_enforces_budget():
    from app.graph.budget import TokenBudgetExceeded, charge_tokens

    state = {"tokens_used": 100}
    msg = AIMessage(
        content="hi",
        usage_metadata={"total_tokens": 200, "input_tokens": 100, "output_tokens": 100},
    )
    delta = charge_tokens(state, msg, budget=500)
    assert delta == {"tokens_used": 300}

    # Over budget
    msg_large = AIMessage(
        content="more",
        usage_metadata={"total_tokens": 300, "input_tokens": 150, "output_tokens": 150},
    )
    with pytest.raises(TokenBudgetExceeded) as exc_info:
        charge_tokens({"tokens_used": 300}, msg_large, budget=500)
    assert exc_info.value.tokens_used == 600
    assert exc_info.value.budget == 500


def test_record_tokens_accumulates_and_enforces_budget():
    from app.graph.budget import TokenBudgetExceeded, record_tokens

    state = {}
    record_tokens(state, tokens=200, budget=500)
    assert state.get("tokens_used") == 200

    record_tokens(state, tokens=200, budget=500)
    assert state.get("tokens_used") == 400

    with pytest.raises(TokenBudgetExceeded) as exc_info:
        record_tokens(state, tokens=150, budget=500)

    assert exc_info.value.tokens_used == 550
    assert exc_info.value.budget == 500
    assert state.get("tokens_used") == 550


def test_budget_settings_configuration():
    assert hasattr(settings, "agent_run_token_budget")
    assert isinstance(settings.agent_run_token_budget, int)
    assert settings.agent_run_token_budget > 0
    assert settings.agent_run_token_budget == 60_000

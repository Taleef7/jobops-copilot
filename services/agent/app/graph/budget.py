"""Per-run token budget: accumulate response usage in graph state; hard abort (Epic 1 / #255).

Fail closed (spec section 12): when the budget is exhausted the run stops with an
explicit budget_exceeded status and a clear message — never silent partial output.
"""
from __future__ import annotations

from typing import Any

from app.config import settings


class TokenBudgetExceeded(RuntimeError):
    def __init__(
        self,
        used: int | str = 0,
        budget: int = 0,
        tokens_used: int | None = None,
        code: str = "budget_exceeded",
    ):
        if isinstance(used, str):
            msg = used
            actual_used = tokens_used if tokens_used is not None else 0
        else:
            actual_used = tokens_used if tokens_used is not None else used
            msg = (
                f"Run token budget exhausted ({actual_used}/{budget} tokens). "
                "The agent stopped before producing partial output; re-run or raise "
                "AGENT_RUN_TOKEN_BUDGET if this run legitimately needs more."
            )
        self.used = actual_used
        self.tokens_used = actual_used
        self.budget = budget
        self.code = code
        super().__init__(msg)


def usage_tokens(message: Any) -> int:
    """Total tokens from a LangChain AIMessage's provider-normalized usage_metadata
    or response_metadata."""
    if message is None or not isinstance(message, object):
        return 0
    if isinstance(message, dict):
        usage = message.get("usage_metadata") or message.get("usage") or message
        if isinstance(usage, dict):
            total = usage.get("total_tokens")
            if total is None:
                total = (usage.get("input_tokens") or 0) + (usage.get("output_tokens") or 0)
            return int(total or 0)
        return 0
    usage = getattr(message, "usage_metadata", None)
    if isinstance(usage, dict):
        total = usage.get("total_tokens")
        if total is None:
            total = (usage.get("input_tokens") or 0) + (usage.get("output_tokens") or 0)
        return int(total or 0)

    # Check response_metadata fallback
    resp_meta = getattr(message, "response_metadata", None)
    if isinstance(resp_meta, dict):
        token_usage = resp_meta.get("token_usage") or resp_meta.get("usage")
        if isinstance(token_usage, dict):
            total = token_usage.get("total_tokens")
            if total is None:
                total = (token_usage.get("input_tokens") or 0) + (
                    token_usage.get("output_tokens") or 0
                )
            return int(total or 0)

    return 0


extract_tokens = usage_tokens


def check_budget(tokens_used: int, budget: int | None = None) -> None:
    budget = settings.agent_run_token_budget if budget is None else budget
    if budget is not None and tokens_used > budget:
        raise TokenBudgetExceeded(tokens_used, budget)


def charge_tokens(state: dict, message: Any, budget: int | None = None) -> dict:
    """Return the state delta ``{"tokens_used": new_total}``; raise when over budget.

    Every LLM-calling node in a registry graph must merge this delta into its
    return value: ``delta = charge_tokens(state, response); return {**delta, ...}``.
    """
    budget = settings.agent_run_token_budget if budget is None else budget
    new_total = int(state.get("tokens_used") or 0) + usage_tokens(message)
    if new_total > budget:
        raise TokenBudgetExceeded(new_total, budget)
    return {"tokens_used": new_total}


def record_tokens(state: dict, tokens: int, budget: int | None = None) -> dict:
    budget = settings.agent_run_token_budget if budget is None else budget
    new_total = int(state.get("tokens_used") or 0) + tokens
    state["tokens_used"] = new_total
    if budget is not None and new_total > budget:
        raise TokenBudgetExceeded(new_total, budget)
    return {"tokens_used": new_total}

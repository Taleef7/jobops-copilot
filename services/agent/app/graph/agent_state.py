"""State shared by the generic specialist-agent graphs."""

from __future__ import annotations

from typing import Any, TypedDict


class AgentRunState(TypedDict, total=False):
    user_id: str
    job_id: str | None
    input: dict[str, Any]
    output: dict[str, Any]
    status: str
    tokens_used: int
    approved: bool

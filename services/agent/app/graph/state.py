"""Shared state for the application-assistant graph (Phase 3 · Workstream K)."""

from __future__ import annotations

from typing import TypedDict


class AssistantState(TypedDict, total=False):
    # Inputs
    description_text: str
    resume_text: str
    profile_text: str
    user_id: str | None
    # Accumulated by the nodes
    parsed: dict
    fit: dict
    research: dict
    draft: dict
    approved: bool
    status: str

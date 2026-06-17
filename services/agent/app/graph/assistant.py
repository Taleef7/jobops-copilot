"""Application-assistant graph (Phase 3 · Workstream K).

A stateful LangGraph workflow that composes the existing **guarded** chains/agents as
nodes: parse-job → score-fit → (conditional, on fit) research → human-in-the-loop review →
draft-outreach. Weak fit short-circuits to a "pass". Because the nodes call the existing
chains, all Phase 2 guards (PII redaction, injection defense, output moderation) are
inherited. The graph is checkpointed so a run can pause at the review interrupt and resume.
"""

from __future__ import annotations

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from app.agents.runner import run_research
from app.chains.draft_outreach import draft_outreach
from app.chains.parse_job import parse_job
from app.chains.score_fit import score_fit
from app.config import settings
from app.graph.state import AssistantState
from app.schemas import DraftOutreachRequest, ResearchRequest, ScoreFitRequest

__all__ = ["build_assistant_graph", "route_after_score", "Command"]


def route_after_score(state: dict, threshold: int | None = None) -> str:
    """Strong fit → research; weak fit → end (a "pass")."""
    threshold = settings.assistant_fit_threshold if threshold is None else threshold
    fit = state.get("fit") or {}
    return "research" if int(fit.get("fit_score", 0)) >= threshold else "end"


def route_after_review(state: dict) -> str:
    return "draft" if state.get("approved") else "end"


def parse_node(state: AssistantState) -> dict:
    parsed = parse_job(state["description_text"])
    return {"parsed": parsed.model_dump(), "status": "parsed"}


def score_node(state: AssistantState) -> dict:
    req = ScoreFitRequest(
        description_text=state["description_text"],
        resume_text=state.get("resume_text", ""),
        profile_text=state.get("profile_text", ""),
        user_id=state.get("user_id"),
    )
    fit = score_fit(req)
    return {"fit": fit.model_dump(), "status": "scored"}


def research_node(state: AssistantState) -> dict:
    parsed = state.get("parsed") or {}
    brief = run_research(
        ResearchRequest(
            company=parsed.get("company") or "the company",
            role=parsed.get("title"),
            context=state["description_text"],
        )
    )
    return {"research": brief.model_dump(), "status": "researched"}


def review_node(state: AssistantState) -> dict:
    """Human-in-the-loop: pause for explicit approval before drafting outreach."""
    decision = interrupt(
        {"reason": "approve_outreach", "fit": state.get("fit"), "research": state.get("research")}
    )
    approved = decision.get("approved") if isinstance(decision, dict) else bool(decision)
    return {"approved": bool(approved), "status": "reviewed"}


def draft_node(state: AssistantState) -> dict:
    parsed = state.get("parsed") or {}
    req = DraftOutreachRequest(
        message_type="recruiter_email",
        company=parsed.get("company"),
        job_context=state["description_text"],
        resume_summary=state.get("resume_text") or state.get("profile_text"),
    )
    draft = draft_outreach(req)
    return {"draft": draft.model_dump(), "status": "drafted"}


def pass_node(state: AssistantState) -> dict:
    """Weak fit: stop honestly without research/outreach."""
    return {"status": "passed"}


def build_assistant_graph(checkpointer=None):
    builder = StateGraph(AssistantState)
    builder.add_node("parse", parse_node)
    builder.add_node("score", score_node)
    builder.add_node("research", research_node)
    builder.add_node("review", review_node)
    builder.add_node("draft", draft_node)
    builder.add_node("pass", pass_node)

    builder.add_edge(START, "parse")
    builder.add_edge("parse", "score")
    builder.add_conditional_edges(
        "score", route_after_score, {"research": "research", "end": "pass"}
    )
    builder.add_edge("research", "review")
    builder.add_conditional_edges(
        "review", route_after_review, {"draft": "draft", "end": END}
    )
    builder.add_edge("draft", END)
    builder.add_edge("pass", END)

    return builder.compile(checkpointer=checkpointer or InMemorySaver())

"""Phase 3 · K — application-assistant graph (routing, nodes, HITL interrupt). No LLM."""

from langgraph.types import Command

from app.graph import assistant as A
from app.schemas import FitScoreResponse, OutreachDraftResponse, ParsedJob, ResearchBrief

# --- K1: routing ------------------------------------------------------------


def test_strong_fit_routes_to_research():
    assert A.route_after_score({"fit": {"fit_score": 80}}, threshold=60) == "research"


def test_weak_fit_ends():
    assert A.route_after_score({"fit": {"fit_score": 30}}, threshold=60) == "end"


def test_route_after_review():
    assert A.route_after_review({"approved": True}) == "draft"
    assert A.route_after_review({"approved": False}) == "end"


# --- K2/K3: nodes + interrupt/resume (fake model) ---------------------------


def _patch_nodes(monkeypatch, fit_score: int):
    parsed = ParsedJob(title="Eng", company="Acme")
    fit = FitScoreResponse(fit_score=fit_score, model_used="fake")
    brief = ResearchBrief(company_summary="ok")
    draft = OutreachDraftResponse(draft_text="hi there", model_used="fake")
    monkeypatch.setattr(A, "parse_job", lambda text, config=None: parsed)
    monkeypatch.setattr(A, "score_fit", lambda req, config=None: fit)
    monkeypatch.setattr(A, "run_research", lambda req, config=None: brief)
    monkeypatch.setattr(A, "draft_outreach", lambda req, config=None: draft)


def _inputs() -> dict:
    return {"description_text": "Build agents", "resume_text": "me", "profile_text": ""}


def test_strong_fit_pauses_then_drafts_on_approval(monkeypatch):
    _patch_nodes(monkeypatch, fit_score=80)
    graph = A.build_assistant_graph()
    cfg = {"configurable": {"thread_id": "t-strong"}}

    paused = graph.invoke(_inputs(), cfg)
    assert "__interrupt__" in paused  # paused at the review interrupt
    assert paused.get("draft") is None
    assert paused["research"]["company_summary"] == "ok"

    final = graph.invoke(Command(resume={"approved": True}), cfg)
    assert final["draft"]["draft_text"] == "hi there"
    assert final["status"] == "drafted"


def test_strong_fit_rejected_produces_no_draft(monkeypatch):
    _patch_nodes(monkeypatch, fit_score=80)
    graph = A.build_assistant_graph()
    cfg = {"configurable": {"thread_id": "t-reject"}}

    graph.invoke(_inputs(), cfg)
    final = graph.invoke(Command(resume={"approved": False}), cfg)
    assert final.get("draft") is None


def test_weak_fit_passes_without_research_or_draft(monkeypatch):
    _patch_nodes(monkeypatch, fit_score=20)
    graph = A.build_assistant_graph()
    result = graph.invoke(_inputs(), {"configurable": {"thread_id": "t-weak"}})
    assert result["status"] == "passed"
    assert result.get("research") is None and result.get("draft") is None
    assert "__interrupt__" not in result

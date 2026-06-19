"""API wiring tests using a fake LLM layer (no network, CI-safe)."""

from fastapi.testclient import TestClient

import app.main as main
from app.schemas import FitScoreResponse, OutreachDraftResponse, ParsedJob

client = TestClient(main.app)


def test_health_reports_llm_state(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: False)
    monkeypatch.setattr(main, "resolve_provider", lambda: None)
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["llm_configured"] is False
    # Build SHA is always reported (defaults to "unknown" when unset) so the
    # drift-check workflow can detect a stale deployment.
    assert "build_sha" in body


def test_parse_job_returns_503_without_provider(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: False)
    res = client.post("/parse-job", json={"description_text": "Build AI agents in Python."})
    assert res.status_code == 503


def test_parse_job_happy_path(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: True)
    monkeypatch.setattr(
        main,
        "parse_job",
        lambda text, config=None: ParsedJob(
            title="AI Software Engineer",
            required_skills=["Python", "LangChain"],
            seniority="junior",
            summary="Entry-level AI role.",
        ),
    )
    res = client.post("/parse-job", json={"description_text": "anything"})
    assert res.status_code == 200
    data = res.json()
    assert data["title"] == "AI Software Engineer"
    assert "Python" in data["required_skills"]


def test_score_fit_happy_path(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: True)
    monkeypatch.setattr(
        main,
        "score_fit",
        lambda req, config=None: FitScoreResponse(
            fit_score=88,
            matched_skills=["Python"],
            missing_skills=[],
            ats_keywords=["Python"],
            fit_summary="Strong fit.",
            recommended_resume_angle="Lead with Python.",
            apply_recommendation="apply",
            confidence_score=80,
            model_used="anthropic:claude-sonnet-4-6",
        ),
    )
    res = client.post(
        "/score-fit",
        json={
            "description_text": "Python AI role",
            "resume_text": "Built Python AI agents",
            "profile_text": "CS new grad",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["fit_score"] == 88
    assert data["model_used"].startswith("anthropic:")


def test_draft_outreach_happy_path(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: True)
    monkeypatch.setattr(
        main,
        "draft_outreach",
        lambda req, config=None: OutreachDraftResponse(
            subject="Excited about the AI Software Engineer role",
            draft_text="Hi, ...",
            safety_notes="Verify the team name before sending.",
            model_used="anthropic:claude-sonnet-4-6",
        ),
    )
    res = client.post("/draft-outreach", json={"message_type": "recruiter_email"})
    assert res.status_code == 200
    assert res.json()["subject"].startswith("Excited")


def test_draft_outreach_rejects_bad_message_type():
    res = client.post("/draft-outreach", json={"message_type": "carrier_pigeon"})
    assert res.status_code == 422


def test_rag_ingest_returns_503_when_disabled(monkeypatch):
    monkeypatch.setattr(main, "rag_available", lambda: False)
    res = client.post(
        "/rag/ingest",
        json={"source_type": "resume", "source_id": "r1", "text": "hello"},
    )
    assert res.status_code == 503


def test_assistant_run_returns_503_without_provider(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: False)
    res = client.post("/assistant/run", json={"description_text": "Build AI agents."})
    assert res.status_code == 503


def test_assistant_run_pauses_for_approval(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: True)

    class _FakeGraph:
        async def ainvoke(self, payload, config=None):
            return {"__interrupt__": [object()], "fit": {"fit_score": 80},
                    "research": {"company_summary": "ok"}}

    monkeypatch.setattr(main, "_get_assistant_graph", lambda: _FakeGraph())
    res = client.post("/assistant/run", json={"description_text": "d", "resume_text": "r"})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "awaiting_approval"
    assert data["thread_id"]
    assert data["fit"]["fit_score"] == 80


def test_assistant_resume_returns_draft(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: True)

    class _FakeGraph:
        async def ainvoke(self, payload, config=None):
            return {"status": "drafted", "draft": {"draft_text": "hi there"}}

    monkeypatch.setattr(main, "_get_assistant_graph", lambda: _FakeGraph())
    res = client.post("/assistant/resume", json={"thread_id": "t1", "approved": True})
    assert res.status_code == 200
    assert res.json()["draft"]["draft_text"] == "hi there"


def test_score_fit_skips_rag_when_disabled(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: True)
    monkeypatch.setattr(main, "rag_available", lambda: False)
    monkeypatch.setattr(
        main,
        "score_fit",
        lambda req, config=None: FitScoreResponse(
            fit_score=70,
            fit_summary="ok",
            recommended_resume_angle="ok",
            apply_recommendation="review",
            confidence_score=60,
            model_used="mock",
        ),
    )
    res = client.post(
        "/score-fit",
        json={"description_text": "d", "resume_text": "r", "profile_text": "p"},
    )
    assert res.status_code == 200

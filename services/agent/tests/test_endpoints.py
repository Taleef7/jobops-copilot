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


def test_parse_job_returns_503_without_provider(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: False)
    res = client.post("/parse-job", json={"description_text": "Build AI agents in Python."})
    assert res.status_code == 503


def test_parse_job_happy_path(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: True)
    monkeypatch.setattr(
        main,
        "parse_job",
        lambda text: ParsedJob(
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
        lambda req: FitScoreResponse(
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
        lambda req: OutreachDraftResponse(
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

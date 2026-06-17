"""Agent endpoint tests using fakes (no network/LLM, CI-safe)."""

from fastapi.testclient import TestClient

import app.main as main
from app.agents.tools import web_search
from app.schemas import InterviewPrep, ResearchBrief, SkillGapItem, SkillGapPlan

client = TestClient(main.app)


def test_web_search_degrades_without_key(monkeypatch):
    import app.agents.tools as tools

    monkeypatch.setattr(tools.settings, "tavily_api_key", None)
    out = web_search.invoke({"query": "Pebble RV company"})
    assert "unavailable" in out.lower()


def test_interview_prep_endpoint(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: True)
    monkeypatch.setattr(
        main,
        "run_interview_prep",
        lambda req, config=None: InterviewPrep(
            likely_questions=["Tell me about an AI agent you built."],
            talking_points=["Built LangChain agents."],
            gaps_to_address=["Limited PyTorch production experience."],
            questions_to_ask=["How does the team evaluate agent quality?"],
        ),
    )
    res = client.post(
        "/agents/interview-prep",
        json={"job_description": "AI Software Engineer", "resume_text": "x"},
    )
    assert res.status_code == 200
    assert res.json()["likely_questions"]


def test_research_endpoint(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: True)
    monkeypatch.setattr(
        main,
        "run_research",
        lambda req, config=None: ResearchBrief(
            company_summary="Pebble builds electric RV trailers.",
            recent_signals=["Launched a new trailer model."],
            role_context="AI for vehicle telemetry.",
            talking_points=["Sustainable mobility."],
            questions_to_ask=["What telemetry stack do you use?"],
            used_web_search=True,
        ),
    )
    res = client.post("/agents/research", json={"company": "Pebble", "role": "AI SWE"})
    assert res.status_code == 200
    assert res.json()["used_web_search"] is True


def test_skill_gap_endpoint(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: True)
    monkeypatch.setattr(
        main,
        "run_skill_gap",
        lambda req, config=None: SkillGapPlan(
            summary="Focus on PyTorch first.",
            prioritized_skills=[
                SkillGapItem(
                    skill="PyTorch",
                    why_it_matters="Core to the role.",
                    learning_resources=["pytorch.org tutorials"],
                    estimated_time="2 weeks",
                )
            ],
        ),
    )
    res = client.post("/agents/skill-gap", json={"missing_skills": ["PyTorch"]})
    assert res.status_code == 200
    assert res.json()["prioritized_skills"][0]["skill"] == "PyTorch"


def test_agents_require_llm(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: False)
    assert client.post("/agents/interview-prep", json={"job_description": "x"}).status_code == 503

"""Schema contract tests — these must stay in lock-step with the TS API."""

from app.schemas import FitScoreLLM, FitScoreResponse, ParsedJob


def test_parsed_job_defaults_are_safe():
    parsed = ParsedJob()
    assert parsed.company is None
    assert parsed.title is None
    assert parsed.seniority == "unknown"
    assert parsed.required_skills == []
    assert parsed.summary == ""


def test_fit_score_clamps_range():
    score = FitScoreLLM(
        fit_score=82,
        matched_skills=["Python"],
        missing_skills=["Rust"],
        ats_keywords=["Python", "LLM"],
        fit_summary="Strong overlap.",
        recommended_resume_angle="Lead with Python.",
        apply_recommendation="apply",
        confidence_score=77,
    )
    assert 0 <= score.fit_score <= 100
    assert score.apply_recommendation in {"apply", "review", "pass"}


def test_fit_score_response_carries_model_used():
    base = FitScoreLLM(
        fit_score=50,
        fit_summary="x",
        recommended_resume_angle="y",
        apply_recommendation="review",
        confidence_score=50,
    )
    resp = FitScoreResponse(**base.model_dump(), model_used="anthropic:claude-sonnet-4-6")
    assert resp.model_used == "anthropic:claude-sonnet-4-6"
    # Response must remain a superset of the LLM output contract.
    assert resp.fit_score == 50

"""Schema contract tests — these must stay in lock-step with the TS API."""

from app.prompts import FIT_SCORER_SYSTEM, INTERVIEW_PREP_SYSTEM, OUTREACH_DRAFTER_SYSTEM
from app.schemas import FeedCuratorAnalysis, FitScoreLLM, FitScoreResponse, ParsedJob, SubSignals


def test_parsed_job_defaults_are_safe():
    parsed = ParsedJob()
    assert parsed.company is None
    assert parsed.title is None
    assert parsed.seniority == "unknown"
    assert parsed.required_skills == []
    assert parsed.summary == ""
    # #355: what the posting doesn't state stays unknown, never a default such as "Remote".
    assert parsed.location is None
    assert parsed.workplace_type is None


def test_parsed_job_reads_location_and_workplace():
    parsed = ParsedJob(location="London, United Kingdom", workplace_type="hybrid")
    assert parsed.location == "London, United Kingdom"
    assert parsed.workplace_type == "hybrid"


def test_parsed_job_workplace_is_one_the_api_knows():
    # Mirrors PARSED_WORKPLACE_TYPES in apps/api/src/lib/analysis-core.ts.
    for value in ("remote", "hybrid", "onsite"):
        assert ParsedJob(workplace_type=value).workplace_type == value
    try:
        ParsedJob(workplace_type="anywhere")
    except ValueError:
        pass
    else:
        raise AssertionError("an unknown workplace type must not validate")


def test_fit_score_clamps_range():
    score = FitScoreLLM(
        fit_score=82,
        matched_skills=[{"skill": "Python", "evidence": "Built Python services."}],
        missing_skills=[{"skill": "Rust", "posting_quote": "Rust experience"}],
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


# --- #354: unknown stays unknown, short skill labels, the candidate's voice ------------


def test_a_fit_read_without_confidence_has_none():
    fit = FitScoreLLM(fit_score=60)
    assert fit.confidence_score is None
    assert FitScoreResponse(**fit.model_dump(), model_used="fake:model").confidence_score is None
    assert FeedCuratorAnalysis(fit_score=60).confidence_score is None


def test_sub_signals_the_model_left_out_are_unknown():
    assert SubSignals().model_dump() == {
        "skills_match": None,
        "title_seniority": None,
        "salary_fit": None,
        "sponsorship_likelihood": None,
    }
    assert FitScoreLLM(fit_score=60).sub_signals.salary_fit is None


def test_no_fit_field_defaults_to_a_made_up_number():
    for model in (SubSignals, FitScoreLLM, FitScoreResponse, FeedCuratorAnalysis):
        for name, field in model.model_fields.items():
            assert field.default != 50, f"{model.__name__}.{name} defaults to 50"


def test_skills_are_labels_with_their_evidence_kept_apart():
    fit = FitScoreLLM(
        fit_score=60,
        matched_skills=[{"skill": "Go", "evidence": "Built the billing API in Go."}],
        missing_skills=[{"skill": "Kafka", "posting_quote": "Experience with Kafka"}],
    )
    assert fit.matched_skills[0].skill == "Go"
    assert fit.matched_skills[0].evidence == "Built the billing API in Go."
    assert fit.missing_skills[0].posting_quote == "Experience with Kafka"

    schema = FitScoreLLM.model_json_schema()
    skill_fields = (
        schema["$defs"]["MatchedSkill"]["properties"]["skill"]["description"]
        + schema["$defs"]["MissingSkill"]["properties"]["skill"]["description"]
    )
    assert skill_fields.lower().count("at most four words") == 2


def test_the_fit_prompt_asks_for_short_skill_names():
    prompt = FIT_SCORER_SYSTEM.lower()
    assert "skill names only, at most four words" in prompt
    assert "at most 8" in prompt


def test_the_fit_prompt_does_not_list_a_skill_as_missing_when_a_match_implies_it():
    prompt = FIT_SCORER_SYSTEM
    assert "PostgreSQL, MySQL or SQL Server implies SQL" in prompt
    assert "TypeScript implies JavaScript" in prompt
    assert "Next.js implies React" in prompt


def test_the_fit_prompt_keeps_unstated_signals_unknown():
    prompt = FIT_SCORER_SYSTEM.lower()
    assert "null" in prompt
    assert "salary_fit" in prompt and "sponsorship_likelihood" in prompt


def test_fit_and_prep_write_to_the_candidate_as_you():
    rule = (
        "Write to the candidate in the second person (\"you\"). "
        "Never use their name or third-person pronouns."
    )
    assert rule in FIT_SCORER_SYSTEM
    assert rule in INTERVIEW_PREP_SYSTEM


def test_the_outreach_prompt_forbids_placeholders_and_long_linkedin_notes():
    prompt = OUTREACH_DRAFTER_SYSTEM
    assert "bracketed placeholder" in prompt
    assert "neutral greeting" in prompt
    assert "300 characters" in prompt

"""Score a job against the user's resume/profile with a real LLM.

Supports optional retrieved resume evidence (Phase 10 RAG): when present, the
model is told to ground its matched skills and summary in those snippets.
"""

from __future__ import annotations

from app.llm.provider import get_model
from app.prompts import FIT_SCORER_SYSTEM
from app.safety.injection import annotate_trace, guard_job_description, injection_refused
from app.safety.pii import maybe_redact
from app.schemas import FitScoreLLM, FitScoreResponse, ScoreFitRequest


def score_fit(req: ScoreFitRequest, config: dict | None = None) -> FitScoreResponse:
    model, label = get_model()

    # Treat the JD as untrusted: scan for injection, redact PII, and delimit it.
    jd_block, verdict = guard_job_description(req.description_text)
    annotate_trace(config, verdict)
    if injection_refused(verdict):
        return FitScoreResponse(
            fit_score=0,
            confidence_score=0,
            fit_summary="Blocked: suspected prompt-injection in the job description.",
            apply_recommendation="pass",
            model_used=label,
        )

    structured = model.with_structured_output(FitScoreLLM)

    parts = [
        f"Job description:\n{jd_block}",
        f"Resume:\n{maybe_redact(req.resume_text)}",
        f"Profile / extra context:\n{maybe_redact(req.profile_text)}",
    ]
    if req.required_skills:
        parts.append("Known required skills: " + ", ".join(req.required_skills))
    if req.preferred_skills:
        parts.append("Known preferred skills: " + ", ".join(req.preferred_skills))
    if req.retrieved_context:
        evidence = "\n".join(f"- {maybe_redact(chunk)}" for chunk in req.retrieved_context)
        parts.append(
            "Retrieved resume evidence (ground matched_skills and the summary in these):\n"
            + evidence
        )

    messages = [("system", FIT_SCORER_SYSTEM), ("human", "\n\n".join(parts))]
    result = structured.invoke(messages, config=config or None)
    return FitScoreResponse(**result.model_dump(), model_used=label)

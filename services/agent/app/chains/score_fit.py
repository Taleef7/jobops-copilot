"""Score a job against the user's resume/profile with a real LLM.

Supports optional retrieved resume evidence (Phase 10 RAG): when present, the
model is told to ground its matched skills and summary in those snippets.
"""

from __future__ import annotations

import logging

from app.llm.provider import get_model
from app.prompts import FIT_SCORER_SYSTEM
from app.safety.injection import annotate_trace, guard_job_description, injection_refused
from app.safety.pii import maybe_redact
from app.schemas import FitScoreLLM, FitScoreResponse, ScoreFitRequest

logger = logging.getLogger("jobops.agent.score_fit")


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
    try:
        result = structured.invoke(messages, config=config or None)
    except Exception:  # noqa: BLE001 - one bounded retry, then let it surface
        # Structured output is a single sampled generation: a malformed tool call is
        # usually transient. Retry exactly once -- an unbounded loop against a model
        # that cannot satisfy the schema would burn budget and stall the request.
        logger.warning("score-fit structured output failed; retrying once", exc_info=True)
        result = structured.invoke(messages, config=config or None)

    payload = result.model_dump() if hasattr(result, "model_dump") else dict(result)
    # Clamp rather than reject: a model that answers 105 has expressed a clear intent,
    # and failing the request over it would be a worse answer than 100.
    payload["fit_score"] = _clamp(payload.get("fit_score"))
    payload["confidence_score"] = _clamp(payload.get("confidence_score"), default=50)
    return FitScoreResponse(**payload, model_used=label)


def _clamp(value: object, default: int = 0, low: int = 0, high: int = 100) -> int:
    """Coerce to an int inside ``[low, high]``; ``default`` when unusable."""
    try:
        number = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))

"""Score a job against the user's resume/profile with a real LLM.

Supports optional retrieved resume evidence (Phase 10 RAG): when present, the
model is told to ground its matched skills and summary in those snippets.
"""

from __future__ import annotations

from app.llm.provider import get_model
from app.prompts import FIT_SCORER_SYSTEM
from app.schemas import FitScoreLLM, FitScoreResponse, ScoreFitRequest


def score_fit(req: ScoreFitRequest) -> FitScoreResponse:
    model, label = get_model()
    structured = model.with_structured_output(FitScoreLLM)

    parts = [
        f"Job description:\n{req.description_text}",
        f"Resume:\n{req.resume_text}",
        f"Profile / extra context:\n{req.profile_text}",
    ]
    if req.required_skills:
        parts.append("Known required skills: " + ", ".join(req.required_skills))
    if req.preferred_skills:
        parts.append("Known preferred skills: " + ", ".join(req.preferred_skills))
    if req.retrieved_context:
        evidence = "\n".join(f"- {chunk}" for chunk in req.retrieved_context)
        parts.append(
            "Retrieved resume evidence (ground matched_skills and the summary in these):\n"
            + evidence
        )

    messages = [("system", FIT_SCORER_SYSTEM), ("human", "\n\n".join(parts))]
    result = structured.invoke(messages)
    return FitScoreResponse(**result.model_dump(), model_used=label)

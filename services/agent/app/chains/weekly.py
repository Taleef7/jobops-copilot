"""Generate LLM-narrated weekly recommendations from pipeline metrics."""

from __future__ import annotations

from app.llm.provider import get_model
from app.prompts import WEEKLY_RECOMMENDATIONS_SYSTEM
from app.schemas import WeeklyRecommendationsLLM, WeeklyRecommendationsRequest


def weekly_recommendations(req: WeeklyRecommendationsRequest) -> WeeklyRecommendationsLLM:
    model, _ = get_model()
    structured = model.with_structured_output(WeeklyRecommendationsLLM)

    metrics_lines = "\n".join(f"- {key}: {value}" for key, value in req.metrics.items())
    missing = ", ".join(req.common_missing_skills) or "none reported"
    human = (
        f"Weekly pipeline metrics:\n{metrics_lines}\n\n"
        f"Most common missing skills: {missing}"
    )
    messages = [("system", WEEKLY_RECOMMENDATIONS_SYSTEM), ("human", human)]
    return structured.invoke(messages)

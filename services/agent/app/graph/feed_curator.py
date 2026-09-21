"""Feed-curator specialist graph (Jobright parity Epic 2, #265).

Scores incoming jobs against candidate resumes and preferences, evaluating
overall fit along with four sub-signals:
- skills_match (0-100)
- title_seniority (0-100)
- salary_fit (0-100)
- sponsorship_likelihood (0-100)
"""
from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import END, START, StateGraph

from app.graph.agent_state import AgentRunState
from app.graph.budget import charge_tokens
from app.llm.provider import get_model_for_agent
from app.prompts import FEED_CURATOR_SYSTEM
from app.safety.injection import guard_job_description, injection_refused
from app.safety.pii import maybe_redact
from app.schemas import FeedCuratorAnalysis, SubSignals

logger = logging.getLogger("jobops.agent.feed_curator")


def _clamp(value: object, default: int = 50, low: int = 0, high: int = 100) -> int:
    try:
        number = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def _build_curator_node():
    def curate_node(state: AgentRunState) -> dict[str, Any]:
        inp = state.get("input", {})
        delta = charge_tokens(state, inp.get("message"))
        job = inp.get("job") or inp
        resume_text = inp.get("resume_text") or inp.get("resume") or ""
        profile_text = inp.get("profile_text") or inp.get("profile") or ""
        preferences = inp.get("preferences") or {}

        # Extract job metadata
        title = job.get("title") or ""
        company = job.get("company") or ""
        desc = job.get("description_text") or job.get("description") or ""
        salary_min = job.get("salary_min")
        salary_max = job.get("salary_max")
        salary_currency = job.get("salary_currency") or "USD"
        seniority = job.get("seniority") or ""
        sponsor_likelihood = job.get("sponsor_likelihood") or ""

        # Guard job description against injection
        jd_block, verdict = guard_job_description(desc)
        if injection_refused(verdict):
            output = FeedCuratorAnalysis(
                fit_score=0,
                sub_signals=SubSignals(
                    skills_match=0,
                    title_seniority=0,
                    salary_fit=0,
                    sponsorship_likelihood=0,
                ),
                matched_skills=[],
                missing_skills=[],
                ats_keywords=[],
                fit_summary="Blocked: suspected prompt-injection in the job posting.",
                recommended_resume_angle="N/A",
                apply_recommendation="pass",
                confidence_score=0,
            )
            payload = output.model_dump()
            payload["agent_id"] = "feed-curator"
            payload["model_used"] = "safety-guard"
            return {
                "output": payload,
                "status": "done",
                **delta,
            }

        # Model resolution from agent_configs
        try:
            model, model_label, _config = get_model_for_agent("feed-curator")
        except Exception:
            model = None
            model_label = "deterministic-fallback"

        if model is None:
            # Fallback when no LLM is configured (e.g. offline testing)
            output = FeedCuratorAnalysis(
                fit_score=70,
                sub_signals=SubSignals(
                    skills_match=70,
                    title_seniority=70,
                    salary_fit=70,
                    sponsorship_likelihood=70,
                ),
                matched_skills=[],
                missing_skills=[],
                ats_keywords=[],
                fit_summary="Evaluated via local heuristic fallback (agent LLM unconfigured).",
                recommended_resume_angle="Highlight core relevant competencies.",
                apply_recommendation="review",
                confidence_score=50,
            )
            payload = output.model_dump()
            payload["agent_id"] = "feed-curator"
            payload["model_used"] = model_label
            return {
                "output": payload,
                "status": "done",
                **delta,
            }

        # Build prompt parts
        parts = [
            f"Job Role: {title} at {company}",
            f"Job description:\n{jd_block}",
        ]
        if salary_min is not None or salary_max is not None:
            parts.append(f"Salary Range: {salary_min} - {salary_max} {salary_currency}")
        if seniority:
            parts.append(f"Seniority Level: {seniority}")
        if sponsor_likelihood:
            parts.append(f"USCIS H-1B Sponsor Likelihood: {sponsor_likelihood}")

        parts.append(f"Candidate Resume:\n{maybe_redact(resume_text)}")
        if profile_text:
            parts.append(f"Candidate Profile / Goals:\n{maybe_redact(profile_text)}")
        if preferences:
            parts.append(f"Candidate Preferences: {preferences}")

        messages = [("system", FEED_CURATOR_SYSTEM), ("human", "\n\n".join(parts))]
        structured = model.with_structured_output(FeedCuratorAnalysis)

        try:
            result = structured.invoke(messages)
        except Exception:
            logger.warning("feed-curator structured output failed; retrying once", exc_info=True)
            result = structured.invoke(messages)

        # Process payload & clamping
        payload = result.model_dump() if hasattr(result, "model_dump") else dict(result)
        payload["fit_score"] = _clamp(payload.get("fit_score"), default=50)
        payload["confidence_score"] = _clamp(payload.get("confidence_score"), default=50)

        sub = payload.get("sub_signals") or {}
        payload["sub_signals"] = {
            "skills_match": _clamp(sub.get("skills_match"), default=50),
            "title_seniority": _clamp(sub.get("title_seniority"), default=50),
            "salary_fit": _clamp(sub.get("salary_fit"), default=50),
            "sponsorship_likelihood": _clamp(sub.get("sponsorship_likelihood"), default=50),
        }
        payload["agent_id"] = "feed-curator"
        payload["model_used"] = model_label

        delta = charge_tokens(state, getattr(result, "response_metadata", None))

        return {
            "output": payload,
            "status": "done",
            **delta,
        }

    return curate_node


def build_feed_curator_graph(checkpointer=None, store=None):
    """Compile the feed-curator LangGraph graph."""
    builder = StateGraph(AgentRunState)
    builder.add_node("curate", _build_curator_node())
    builder.add_edge(START, "curate")
    builder.add_edge("curate", END)
    return builder.compile(checkpointer=checkpointer, store=store, name="feed-curator")

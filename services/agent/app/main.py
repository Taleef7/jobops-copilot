"""JobOps Copilot AI agent service (FastAPI).

Exposes real-LLM analysis endpoints that the Node API delegates to when
``AGENT_SERVICE_URL`` is set. Returns 503 when no provider is configured so the
Node API can transparently fall back to its deterministic mock.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException

from app.chains.draft_outreach import draft_outreach
from app.chains.parse_job import parse_job
from app.chains.score_fit import score_fit
from app.chains.weekly import weekly_recommendations
from app.llm.provider import LLMNotConfigured, llm_available, resolve_provider
from app.schemas import (
    DraftOutreachRequest,
    FitScoreResponse,
    OutreachDraftResponse,
    ParsedJob,
    ParseJobRequest,
    ScoreFitRequest,
    WeeklyRecommendationsLLM,
    WeeklyRecommendationsRequest,
)

logger = logging.getLogger("jobops.agent")

app = FastAPI(
    title="JobOps Copilot Agent Service",
    version="0.1.0",
    summary="Real-LLM analysis and agent orchestration for JobOps Copilot.",
)


def _require_llm() -> None:
    if not llm_available():
        raise HTTPException(
            status_code=503,
            detail="LLM provider not configured; the API will use its mock fallback.",
        )


def _run(fn, *args):
    """Execute a chain, translating provider errors into clean HTTP errors."""
    try:
        return fn(*args)
    except LLMNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - surface upstream model/network failures
        logger.exception("agent chain failed")
        raise HTTPException(status_code=502, detail=f"Agent chain failed: {exc}") from exc


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "llm_configured": llm_available(),
        "provider": resolve_provider(),
    }


@app.post("/parse-job", response_model=ParsedJob)
def parse_job_endpoint(req: ParseJobRequest) -> ParsedJob:
    _require_llm()
    return _run(parse_job, req.description_text)


@app.post("/score-fit", response_model=FitScoreResponse)
def score_fit_endpoint(req: ScoreFitRequest) -> FitScoreResponse:
    _require_llm()
    return _run(score_fit, req)


@app.post("/draft-outreach", response_model=OutreachDraftResponse)
def draft_outreach_endpoint(req: DraftOutreachRequest) -> OutreachDraftResponse:
    _require_llm()
    return _run(draft_outreach, req)


@app.post("/weekly-recommendations", response_model=WeeklyRecommendationsLLM)
def weekly_recommendations_endpoint(
    req: WeeklyRecommendationsRequest,
) -> WeeklyRecommendationsLLM:
    _require_llm()
    return _run(weekly_recommendations, req)

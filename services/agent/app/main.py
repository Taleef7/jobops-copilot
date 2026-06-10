"""JobOps Copilot AI agent service (FastAPI).

Exposes real-LLM analysis endpoints that the Node API delegates to when
``AGENT_SERVICE_URL`` is set. Returns 503 when no provider is configured so the
Node API can transparently fall back to its deterministic mock.
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.agents.runner import run_interview_prep, run_research, run_skill_gap
from app.chains.draft_outreach import draft_outreach
from app.chains.parse_job import parse_job
from app.chains.score_fit import score_fit
from app.chains.weekly import weekly_recommendations
from app.config import settings
from app.llm.provider import LLMNotConfigured, llm_available, resolve_provider
from app.rag.store import ingest_document, rag_available, retrieve, retrieve_resume_evidence
from app.schemas import (
    DraftOutreachRequest,
    FitScoreResponse,
    InterviewPrep,
    InterviewPrepRequest,
    OutreachDraftResponse,
    ParsedJob,
    ParseJobRequest,
    ResearchBrief,
    ResearchRequest,
    ScoreFitRequest,
    SkillGapPlan,
    SkillGapRequest,
    TelemetryInsights,
    TelemetryRequest,
    WeeklyRecommendationsLLM,
    WeeklyRecommendationsRequest,
)
from app.telemetry.insights import ev_demo_insights, pipeline_insights

logger = logging.getLogger("jobops.agent")


def _configure_app_insights() -> bool:
    """Enable Azure Monitor (App Insights) when the conn string is present."""
    if not os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING"):
        return False
    try:
        from azure.monitor.opentelemetry import configure_azure_monitor

        configure_azure_monitor()
        return True
    except Exception:
        logging.getLogger(__name__).warning(
            "Application Insights failed to start; continuing without telemetry.",
            exc_info=True,
        )
        return False


_configure_app_insights()

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


class IngestRequest(BaseModel):
    source_type: str
    source_id: str
    text: str
    user_id: str | None = None


class SearchRequest(BaseModel):
    query: str
    k: int = Field(default=4, ge=1, le=20)
    source_type: str | None = None
    source_id: str | None = None
    user_id: str | None = None


def _active_model(provider: str | None) -> str | None:
    return {
        "anthropic": settings.anthropic_model,
        "openai": settings.openai_model,
        "azure_openai": settings.azure_openai_deployment or "gpt-4o-mini",
        "google_genai": settings.gemini_model,
    }.get(provider or "")


@app.get("/health")
def health() -> dict:
    provider = resolve_provider()
    return {
        "status": "ok",
        "llm_configured": llm_available(),
        "provider": provider,
        "model": _active_model(provider),
        "rag_enabled": rag_available(),
        "tavily_configured": bool(settings.tavily_api_key),
    }


@app.post("/parse-job", response_model=ParsedJob)
def parse_job_endpoint(req: ParseJobRequest) -> ParsedJob:
    _require_llm()
    return _run(parse_job, req.description_text)


@app.post("/score-fit", response_model=FitScoreResponse)
def score_fit_endpoint(req: ScoreFitRequest) -> FitScoreResponse:
    _require_llm()
    # RAG augmentation: ground the assessment in the resume chunks most relevant
    # to this job. Best-effort — falls through to direct scoring if RAG is off.
    if rag_available() and req.resume_text and not req.retrieved_context:
        evidence = retrieve_resume_evidence(
            req.resume_text, req.description_text, user_id=req.user_id
        )
        if evidence:
            req.retrieved_context = evidence
    return _run(score_fit, req)


@app.post("/rag/ingest")
def rag_ingest_endpoint(req: IngestRequest) -> dict:
    if not rag_available():
        raise HTTPException(status_code=503, detail="RAG is disabled; set DATABASE_URL.")
    count = _run(ingest_document, req.source_type, req.source_id, req.text, req.user_id)
    return {"source_type": req.source_type, "source_id": req.source_id, "chunks_ingested": count}


@app.post("/rag/search")
def rag_search_endpoint(req: SearchRequest) -> dict:
    if not rag_available():
        raise HTTPException(status_code=503, detail="RAG is disabled; set DATABASE_URL.")
    matches = _run(retrieve, req.query, req.k, req.source_type, req.source_id, req.user_id)
    return {"query": req.query, "matches": matches}


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


# --- Phase 8 agents ---------------------------------------------------------


@app.post("/agents/interview-prep", response_model=InterviewPrep)
def interview_prep_endpoint(req: InterviewPrepRequest) -> InterviewPrep:
    _require_llm()
    return _run(run_interview_prep, req)


@app.post("/agents/research", response_model=ResearchBrief)
def research_endpoint(req: ResearchRequest) -> ResearchBrief:
    _require_llm()
    return _run(run_research, req)


@app.post("/agents/skill-gap", response_model=SkillGapPlan)
def skill_gap_endpoint(req: SkillGapRequest) -> SkillGapPlan:
    _require_llm()
    return _run(run_skill_gap, req)


# --- Phase 11 telemetry -----------------------------------------------------
# These do NOT require an LLM: pandas computes the analysis, and narration
# degrades to a deterministic summary when no provider is configured.


@app.post("/telemetry/insights", response_model=TelemetryInsights)
def telemetry_insights_endpoint(req: TelemetryRequest) -> TelemetryInsights:
    return _run(pipeline_insights, req.series)


@app.get("/telemetry/ev-demo", response_model=TelemetryInsights)
def telemetry_ev_demo_endpoint() -> TelemetryInsights:
    return _run(ev_demo_insights)

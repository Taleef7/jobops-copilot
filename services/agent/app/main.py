"""JobOps Copilot AI agent service (FastAPI).

Exposes real-LLM analysis endpoints that the Node API delegates to when
``AGENT_SERVICE_URL`` is set. Returns 503 when no provider is configured so the
Node API can transparently fall back to its deterministic mock.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from langgraph.types import Command
from pydantic import BaseModel, Field

from app.agents.runner import run_interview_prep, run_research, run_skill_gap
from app.auth import assert_auth_configured, is_authorized
from app.chains.draft_outreach import draft_outreach
from app.chains.parse_job import parse_job
from app.chains.score_fit import score_fit
from app.chains.weekly import weekly_recommendations
from app.config import settings
from app.graph.assistant import build_assistant_graph
from app.llm.provider import LLMNotConfigured, get_model, llm_available, resolve_provider
from app.obs import traced_config, traced_span
from app.prompts import CHAT_ASSISTANT_SYSTEM
from app.rag.store import ingest_document, rag_available, retrieve, retrieve_resume_evidence
from app.safety.injection import (
    annotate_trace,
    injection_refused,
    scan_for_injection,
    wrap_untrusted,
)
from app.schemas import (
    ChatRequest,
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


# --- Assistant graph + durable HITL checkpointer (QA·D) ---------------------
# The assistant graph is checkpointed so a run can pause at the human-review
# interrupt and resume later — possibly on a different instance or after a
# restart. With DATABASE_URL set we persist those checkpoints in Postgres
# (durable); otherwise we fall back to an in-memory saver (lost on restart).
# The Postgres saver is async-only, so the assistant run/resume/stream paths
# all drive the graph through its async API (ainvoke/astream/aget_state).
_assistant_graph = None
_checkpointer_pool = None


async def _build_durable_assistant_graph():
    """Build the assistant graph backed by a Postgres checkpointer.

    Returns ``(graph, pool)``; the caller owns closing ``pool`` on shutdown.
    Postgres deps are imported lazily so the light CI test job (which runs
    without DATABASE_URL and omits requirements-rag.txt) never imports them.
    Raises on any connection/setup failure so callers can fall back to memory.
    """
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
    from psycopg.rows import dict_row
    from psycopg_pool import AsyncConnectionPool

    # The saver requires autocommit + dict rows + no server-side prepared
    # statements (the latter keeps it pgbouncer-safe). open=False so we can
    # await .open() explicitly and surface connection errors here.
    pool = AsyncConnectionPool(
        conninfo=settings.database_url,
        max_size=10,
        open=False,
        kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
    )
    await pool.open()
    # If setup() fails after a successful open() (e.g. the role can't CREATE
    # TABLE), close the pool here — the caller never receives it, so its
    # `finally` can't, and the open connections would otherwise leak.
    try:
        # Strict msgpack: restrict checkpoint deserialization to a built-in
        # allowlist of safe types. The default is permissive, which lets anyone
        # who can write checkpoint rows trigger code execution on resume. Our
        # graph only persists JSON-native state plus langgraph control types
        # (Interrupt/Command/…), all of which are in the safe allowlist.
        serde = JsonPlusSerializer(allowed_msgpack_modules=None)
        saver = AsyncPostgresSaver(pool, serde=serde)
        await saver.setup()  # idempotent: creates the checkpoint tables if absent
        return build_assistant_graph(checkpointer=saver), pool
    except Exception:
        await pool.close()
        raise


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    """Upgrade the assistant graph to the durable Postgres checkpointer on
    startup when DATABASE_URL is set; degrade to the in-memory saver on any
    failure so a checkpointer outage never blocks the service from starting."""
    global _assistant_graph, _checkpointer_pool
    # Fail closed: refuse to start on a public cloud runtime with auth disabled.
    assert_auth_configured()
    if settings.database_url:
        try:
            _assistant_graph, _checkpointer_pool = await _build_durable_assistant_graph()
            logger.info("assistant HITL checkpointer: durable (Postgres)")
        except Exception:  # noqa: BLE001 - degrade gracefully, never block startup
            logger.warning(
                "durable HITL checkpointer unavailable; using in-memory saver "
                "(in-flight runs will not survive a restart)",
                exc_info=True,
            )
    try:
        yield
    finally:
        if _checkpointer_pool is not None:
            try:
                await _checkpointer_pool.close()
            except Exception:  # noqa: BLE001 - never let teardown raise on shutdown
                logger.warning("error closing HITL checkpointer pool", exc_info=True)
            _checkpointer_pool = None


app = FastAPI(
    title="JobOps Copilot Agent Service",
    version="0.1.0",
    summary="Real-LLM analysis and agent orchestration for JobOps Copilot.",
    lifespan=_lifespan,
)


@app.middleware("http")
async def _enforce_agent_key(request: Request, call_next):
    """Reject any request lacking the server-to-server shared secret (QA·A).

    No-op when AGENT_API_KEY is unset; /health + /openapi.json are always exempt.
    """
    if not is_authorized(request.url.path, request.headers):
        # Log the rejection (never the attempted key) so scanning is visible in
        # App Insights — the absence of this trace would hide the very attack this guards.
        client = request.client.host if request.client else "unknown"
        logger.warning(
            "agent auth rejected: %s %s from %s", request.method, request.url.path, client
        )
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return await call_next(request)


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
    # Re-index even when the stored chunks already match the submitted text. Ingest is
    # content-idempotent, so this is only needed when the *text* is unchanged but its
    # vectors are stale — e.g. after an embedding-model change.
    force: bool = False


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
        # The git SHA baked into the image at build time (Dockerfile ARG GIT_SHA).
        # The agent-drift-check workflow compares this to the latest agent commit.
        "build_sha": os.getenv("AGENT_BUILD_SHA") or "unknown",
    }


@app.post("/parse-job", response_model=ParsedJob)
def parse_job_endpoint(req: ParseJobRequest) -> ParsedJob:
    _require_llm()
    return _run(parse_job, req.description_text, traced_config("parse-job"))


@app.post("/score-fit", response_model=FitScoreResponse)
def score_fit_endpoint(req: ScoreFitRequest) -> FitScoreResponse:
    _require_llm()
    # Open the score-fit observation *before* RAG so the `rag.retrieve` span
    # nests inside this trace instead of being emitted as a separate root trace.
    # No-op safe: `traced_span` yields None when tracing is disabled.
    with traced_span("score-fit", user_id=req.user_id):
        # RAG augmentation: ground the assessment in the resume chunks most
        # relevant to this job. Best-effort — falls through to direct scoring.
        if rag_available() and req.resume_text and not req.retrieved_context:
            evidence = retrieve_resume_evidence(
                req.resume_text,
                req.description_text,
                user_id=req.user_id,
                # The API parses the job before scoring, so these are normally
                # populated; they are what the distilled query is built from (#198).
                required_skills=req.required_skills,
                preferred_skills=req.preferred_skills,
                title=req.title,
            )
            if evidence:
                req.retrieved_context = evidence
        return _run(score_fit, req, traced_config("score-fit", user_id=req.user_id))


@app.post("/rag/ingest")
def rag_ingest_endpoint(req: IngestRequest) -> dict:
    if not rag_available():
        raise HTTPException(status_code=503, detail="RAG is disabled; set DATABASE_URL.")
    count = _run(ingest_document, req.source_type, req.source_id, req.text, req.user_id, req.force)
    return {"source_type": req.source_type, "source_id": req.source_id, "chunks_ingested": count}


@app.post("/rag/search")
def rag_search_endpoint(req: SearchRequest) -> dict:
    # Retrieval must be scoped to a tenant. Reject an unscoped search rather than let a
    # missing user_id fall through to a cross-tenant read (AI-4).
    if not (req.user_id and req.user_id.strip()):
        raise HTTPException(
            status_code=400, detail="user_id is required to scope retrieval to a tenant."
        )
    if not rag_available():
        raise HTTPException(status_code=503, detail="RAG is disabled; set DATABASE_URL.")
    matches = _run(retrieve, req.query, req.k, req.source_type, req.source_id, req.user_id)
    return {"query": req.query, "matches": matches}


@app.post("/draft-outreach", response_model=OutreachDraftResponse)
def draft_outreach_endpoint(req: DraftOutreachRequest) -> OutreachDraftResponse:
    _require_llm()
    return _run(draft_outreach, req, traced_config("draft-outreach"))


@app.post("/weekly-recommendations", response_model=WeeklyRecommendationsLLM)
def weekly_recommendations_endpoint(
    req: WeeklyRecommendationsRequest,
) -> WeeklyRecommendationsLLM:
    _require_llm()
    return _run(weekly_recommendations, req, traced_config("weekly-recommendations"))


# --- Phase 8 agents ---------------------------------------------------------


@app.post("/agents/interview-prep", response_model=InterviewPrep)
def interview_prep_endpoint(req: InterviewPrepRequest) -> InterviewPrep:
    _require_llm()
    return _run(run_interview_prep, req, traced_config("agent-interview-prep"))


@app.post("/agents/research", response_model=ResearchBrief)
def research_endpoint(req: ResearchRequest) -> ResearchBrief:
    _require_llm()
    return _run(run_research, req, traced_config("agent-research"))


@app.post("/agents/skill-gap", response_model=SkillGapPlan)
def skill_gap_endpoint(req: SkillGapRequest) -> SkillGapPlan:
    _require_llm()
    return _run(run_skill_gap, req, traced_config("agent-skill-gap"))


# --- Phase 3 application-assistant (LangGraph) ------------------------------


class AssistantRunRequest(BaseModel):
    description_text: str
    resume_text: str = ""
    profile_text: str = ""
    user_id: str | None = None


class AssistantResumeRequest(BaseModel):
    thread_id: str
    approved: bool


def _get_assistant_graph():
    """Return the assistant graph singleton.

    Built durably (Postgres) by the lifespan handler when DATABASE_URL is set;
    otherwise lazily built here with the in-memory saver as a fallback.
    """
    global _assistant_graph
    if _assistant_graph is None:
        _assistant_graph = build_assistant_graph()
    return _assistant_graph


async def _arun(coro_fn, *args):
    """Await an async graph call, translating provider errors into HTTP errors."""
    try:
        return await coro_fn(*args)
    except LLMNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - surface upstream model/network failures
        logger.exception("agent chain failed")
        raise HTTPException(status_code=502, detail=f"Agent chain failed: {exc}") from exc


def _assistant_response(thread_id: str, state: dict) -> dict:
    """Shape the graph state for the API. `__interrupt__` means it paused for approval."""
    awaiting = "__interrupt__" in state
    return {
        "thread_id": thread_id,
        "status": "awaiting_approval" if awaiting else state.get("status"),
        "parsed": state.get("parsed"),
        "fit": state.get("fit"),
        "research": state.get("research"),
        "draft": state.get("draft"),
    }


def _traced_graph_config(name: str, thread_id: str, user_id: str | None) -> dict:
    """A LangGraph config that is both checkpointed and traced.

    The assistant paths need `configurable.thread_id` (the durable HITL checkpointer
    keys resume-after-interrupt on it) *and* the Langfuse callbacks every other LLM
    entrypoint already sets. `configurable` is applied last so a traced config can never
    displace the thread id (#200).

    The thread id is also passed as the Langfuse `session_id`: run and resume of one HITL
    flow are separate HTTP requests, so without it the resumed turn would trace as an
    orphan root instead of joining its run (#204 review).
    """
    return {
        **traced_config(name, session_id=thread_id, user_id=user_id),
        "configurable": {"thread_id": thread_id},
    }


@app.post("/assistant/run")
async def assistant_run_endpoint(req: AssistantRunRequest) -> dict:
    _require_llm()
    graph = _get_assistant_graph()
    thread_id = str(uuid.uuid4())
    config = _traced_graph_config("assistant-run", thread_id, req.user_id)
    state = await _arun(
        graph.ainvoke,
        {
            "description_text": req.description_text,
            "resume_text": req.resume_text,
            "profile_text": req.profile_text,
            "user_id": req.user_id,
        },
        config,
    )
    return _assistant_response(thread_id, state)


@app.post("/assistant/resume")
async def assistant_resume_endpoint(req: AssistantResumeRequest) -> dict:
    _require_llm()
    graph = _get_assistant_graph()
    config = _traced_graph_config("assistant-resume", req.thread_id, None)
    state = await _arun(graph.ainvoke, Command(resume={"approved": req.approved}), config)
    return _assistant_response(req.thread_id, state)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def _assistant_event_stream(payload: dict, config: dict):
    """Stream the assistant run as SSE: one `status` event per node, an
    `awaiting_approval` event at the HITL interrupt, else a final `result`."""
    graph = _get_assistant_graph()
    thread_id = config["configurable"]["thread_id"]
    awaiting = False
    try:
        async for update in graph.astream(payload, config, stream_mode="updates"):
            for node, delta in update.items():
                if node == "__interrupt__":
                    awaiting = True
                    state = (await graph.aget_state(config)).values
                    snapshot = _assistant_response(thread_id, state)
                    snapshot["status"] = "awaiting_approval"
                    yield _sse("awaiting_approval", snapshot)
                else:
                    status = delta.get("status") if isinstance(delta, dict) else None
                    yield _sse("status", {"node": node, "status": status})
        if not awaiting:
            final = (await graph.aget_state(config)).values
            yield _sse("result", _assistant_response(thread_id, final))
    except Exception as exc:  # noqa: BLE001 - surface streaming failures as an SSE error
        logger.exception("assistant stream failed")
        yield _sse("error", {"message": str(exc)})


@app.post("/assistant/stream")
async def assistant_stream_endpoint(req: AssistantRunRequest) -> StreamingResponse:
    _require_llm()
    thread_id = str(uuid.uuid4())
    config = _traced_graph_config("assistant-stream", thread_id, req.user_id)
    payload = {
        "description_text": req.description_text,
        "resume_text": req.resume_text,
        "profile_text": req.profile_text,
        "user_id": req.user_id,
    }
    return StreamingResponse(
        _assistant_event_stream(payload, config), media_type="text/event-stream"
    )


# --- Phase 5 (overhaul) conversational assistant ----------------------------


def _build_chat_messages(req: ChatRequest):
    """Map the request into a LangChain message list: a system prompt (with any
    job context delimited as untrusted data) followed by the conversation turns."""
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    system = CHAT_ASSISTANT_SYSTEM
    if req.context:
        block = wrap_untrusted(req.context, "JOB CONTEXT")
        system = f"{system}\n\nContext about the job the user is currently viewing:\n{block}"

    messages = [SystemMessage(content=system)]
    for turn in req.messages:
        if turn.role == "assistant":
            messages.append(AIMessage(content=turn.content))
        else:
            messages.append(HumanMessage(content=turn.content))
    return messages


def _chunk_text(chunk) -> str:
    """Extract plain text from a streamed chunk; some providers return content parts."""
    content = getattr(chunk, "content", "") or ""
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict):
                parts.append(part.get("text", ""))
            else:
                parts.append(str(part))
        return "".join(parts)
    return content


async def _chat_event_stream(req: ChatRequest):
    """Stream the assistant reply as SSE `token` events, then a final `done`."""
    # Scan EVERY user-role turn (and the context): the whole transcript is sent
    # to the model, so an override hidden in an earlier turn must still be caught
    # — checking only the latest turn would let a benign final turn bypass refusal.
    user_text = "\n".join(turn.content for turn in req.messages if turn.role == "user")
    verdict = scan_for_injection(f"{user_text}\n{req.context or ''}")
    if injection_refused(verdict):
        yield _sse("token", {"text": "I can't help with that request."})
        yield _sse("done", {"model_used": None})
        return

    try:
        model, label = get_model()
        messages = _build_chat_messages(req)
        # Trace the chat turn like every other LLM call. `user_id` groups a user's
        # conversations in Langfuse; annotate_trace surfaces a flagged-but-allowed
        # injection verdict (INJECTION_ACTION=flag) that refusal above let through.
        config = traced_config("assistant-chat", user_id=req.user_id)
        annotate_trace(config, verdict)
        async for chunk in model.astream(messages, config=config or None):
            text = _chunk_text(chunk)
            if text:
                yield _sse("token", {"text": text})
        yield _sse("done", {"model_used": label})
    except Exception as exc:  # noqa: BLE001 - surface streaming failures as an SSE error
        logger.exception("assistant chat stream failed")
        yield _sse("error", {"message": str(exc)})


@app.post("/assistant/chat")
async def assistant_chat_endpoint(req: ChatRequest) -> StreamingResponse:
    _require_llm()
    return StreamingResponse(_chat_event_stream(req), media_type="text/event-stream")


# --- Phase 11 telemetry -----------------------------------------------------
# These do NOT require an LLM: pandas computes the analysis, and narration
# degrades to a deterministic summary when no provider is configured.


@app.post("/telemetry/insights", response_model=TelemetryInsights)
def telemetry_insights_endpoint(req: TelemetryRequest) -> TelemetryInsights:
    return _run(pipeline_insights, req.series)


@app.get("/telemetry/ev-demo", response_model=TelemetryInsights)
def telemetry_ev_demo_endpoint() -> TelemetryInsights:
    return _run(ev_demo_insights)

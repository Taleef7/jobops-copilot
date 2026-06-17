# Phase 3: LangGraph, MCP & streaming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Confirm exact third-party APIs (LangGraph `StateGraph`/`interrupt`/checkpointer + `Command(resume=...)`, MCP Python SDK `FastMCP` streamable-HTTP + auth, `langchain-mcp-adapters` `MultiServerMCPClient`, FastAPI `StreamingResponse` + `.astream_events()`, Express SSE passthrough) via Context7 at the start of the relevant workstream.

**Goal:** Add a stateful LangGraph application-assistant (with a human-in-the-loop interrupt), a remote authenticated MCP server exposing JobOps tools, end-to-end SSE streaming of the assistant run, and agent-as-MCP-client tool use — without breaking graceful degradation.

**Architecture:** Four sub-issues, each its own branch/PR. **K** (Python/agent): a `StateGraph` composes the existing guarded chains/agents as nodes with conditional routing and an `interrupt` before outreach. **L** (new `services/mcp`): a FastMCP streamable-HTTP server that bridges to the existing REST API (auth-forwarded). **M** (agent + API + web): SSE streams the graph's `astream_events` through an Express passthrough to a live web panel. **N** (Python/agent): the research path loads external MCP tools via `langchain-mcp-adapters`, falling back to Tavily.

**Tech Stack:** Python 3.12, FastAPI, LangChain, **LangGraph**, **MCP Python SDK (FastMCP)**, **langchain-mcp-adapters**; TypeScript/Express; Next.js 16/React 19; pytest; GitHub Actions.

**Conventions to follow (existing patterns):**
- Agent settings: add fields to `app/config.py` `Settings` (pydantic-settings; e.g. `assistant_fit_threshold` ← `ASSISTANT_FIT_THRESHOLD`).
- Endpoints in `app/main.py` use `_require_llm()` then `_run(fn, *args)`; chains/agents accept `config: dict | None = None` and are already Phase-2-guarded.
- Agent tests fake the model with the `_FakeModel`/`_FakeStructured` + `monkeypatch.setattr(mod, "get_model", ...)` pattern (`tests/test_tracing.py`); graph/agent tests must run **without** a provider key (CI-safe, per `conftest.py`).
- API delegation lives in `apps/api/src/lib/agent-client.ts` (fetch + graceful fallback). Web calls the API via the `/api/proxy` pattern.
- Graceful degradation is sacred: no provider/agent/MCP must **degrade**, never raise into the request path.
- **Sequencing:** K → M → N share the agent/graph files — implement in order, each branched off `main` **after** the previous merges. **L is independent** (separate `services/mcp`) and can run in parallel. (Lesson from Phase 2.)

---

## File structure

**Workstream K — LangGraph application-assistant (agent)**
- Create `services/agent/app/graph/__init__.py`, `app/graph/state.py` (`AssistantState` TypedDict), `app/graph/assistant.py` (`build_assistant_graph()` + node functions + routing).
- Modify `app/config.py` — `assistant_fit_threshold: int = 60`.
- Modify `app/main.py` — `POST /assistant/run`, `POST /assistant/resume`.
- Modify `app/schemas.py` — `AssistantRunRequest`, `AssistantResumeRequest`, `AssistantState`-response.
- Modify `apps/api/src/lib/agent-client.ts` + a route + minimal web action (kick off a run, show result + approval).
- Create `services/agent/tests/test_assistant_graph.py`.

**Workstream L — MCP server (new `services/mcp`)**
- Create `services/mcp/pyproject.toml` (or `requirements.txt`), `server.py` (FastMCP + tools), `api_client.py` (REST bridge), `README.md`, `tests/test_tools.py`.
- Modify `.env.example` — `MCP_SERVER_API_BASE_URL`, `MCP_SERVER_API_KEY`.

**Workstream M — Streaming (agent + API + web)**
- Modify `app/main.py` — `POST /assistant/stream` (`StreamingResponse`, `text/event-stream`).
- Create `apps/api/src/routes/assistant.ts` (SSE passthrough) + mount in `app.ts`.
- Modify `apps/web` — a live assistant panel consuming the stream + approval control.
- Create `services/agent/tests/test_assistant_stream.py`.

**Workstream N — MCP client (agent)**
- Create `app/agents/mcp_tools.py` (`load_mcp_tools()` + Tavily fallback).
- Modify `app/agents/runner.py` (research) and/or `app/graph/assistant.py` (research node) to use the loaded tools.
- Modify `app/config.py` — `mcp_client_servers: str | None = None`.
- Create `services/agent/tests/test_mcp_tools.py`.

---

## Workstream K — LangGraph application-assistant

### Task K1: deps + state + graph routing (TDD, no LLM)
**Files:** Modify `services/agent/requirements*.txt`, `app/config.py`; Create `app/graph/__init__.py`, `app/graph/state.py`, `app/graph/assistant.py`; Test `tests/test_assistant_graph.py`

- [ ] **Step 0: Confirm API** — via Context7, confirm LangGraph `StateGraph`, `START`/`END`, `add_conditional_edges`, `interrupt` (`langgraph.types`), `MemorySaver` (`langgraph.checkpoint.memory`), and `Command(resume=...)`. Confirm `langgraph` is a direct dep (add to `requirements.txt` if only transitive via `langchain`).
- [ ] **Step 1: Failing test** — routing only, with node functions injected so no LLM runs:

```python
from app.graph.assistant import route_after_score

def test_strong_fit_routes_to_research():
    assert route_after_score({"fit": {"fit_score": 80}}, threshold=60) == "research"

def test_weak_fit_ends():
    assert route_after_score({"fit": {"fit_score": 30}}, threshold=60) == "end"
```

- [ ] **Step 2: Run — expect FAIL** — `pytest tests/test_assistant_graph.py -v`.
- [ ] **Step 3: Implement** — `app/graph/state.py`:

```python
from __future__ import annotations
from typing import TypedDict

class AssistantState(TypedDict, total=False):
    description_text: str
    resume_text: str
    profile_text: str
    user_id: str | None
    parsed: dict
    fit: dict
    research: dict
    draft: dict
    approved: bool
    status: str
```

`app/graph/assistant.py` (routing + builder; nodes wrap existing functions in K2):

```python
from __future__ import annotations
from app.config import settings

def route_after_score(state: dict, threshold: int | None = None) -> str:
    threshold = settings.assistant_fit_threshold if threshold is None else threshold
    fit = state.get("fit") or {}
    return "research" if int(fit.get("fit_score", 0)) >= threshold else "end"
```

Add `assistant_fit_threshold: int = 60` to `Settings`.

- [ ] **Step 4: Run — expect PASS. Commit** — `feat(agent): assistant graph state + fit-based routing`.

### Task K2: nodes wrapping the existing chains/agents (TDD, fake model)
**Files:** Modify `app/graph/assistant.py`; Test `tests/test_assistant_graph.py`

- [ ] **Step 1–2: Failing test** — build the graph with `get_model` monkeypatched (fake model returning canned `ParsedJob`/`FitScoreLLM`); invoke with a strong-fit fake and assert the state collects `parsed`, `fit`, and (strong path) `research`/`draft`. Use the `_FakeModel` pattern; the research node's agent is also monkeypatched.
- [ ] **Step 3: Implement** node functions calling the existing guarded functions and writing into state:

```python
from app.chains.parse_job import parse_job
from app.chains.score_fit import score_fit
from app.chains.draft_outreach import draft_outreach
from app.agents.runner import run_research
from app.schemas import ScoreFitRequest, DraftOutreachRequest, ResearchRequest

def parse_node(state: dict) -> dict:
    parsed = parse_job(state["description_text"])
    return {"parsed": parsed.model_dump(), "status": "scored"}

def score_node(state: dict) -> dict:
    req = ScoreFitRequest(description_text=state["description_text"],
                          resume_text=state.get("resume_text", ""),
                          profile_text=state.get("profile_text", ""),
                          user_id=state.get("user_id"))
    fit = score_fit(req)
    return {"fit": fit.model_dump(), "status": "researched?"}
# research_node -> run_research(ResearchRequest(...)); draft_node -> draft_outreach(DraftOutreachRequest(...))
```

`build_assistant_graph()` wires `START → parse → score → [route_after_score] → research → <interrupt> → draft → END` (interrupt added in K3); compile without a checkpointer here.

- [ ] **Step 4–5: Run PASS; `ruff`. Commit** — `feat(agent): assistant graph nodes over parse/score/research/outreach`.

### Task K3: human-in-the-loop interrupt + checkpointer + resume (TDD)
**Files:** Modify `app/graph/assistant.py`; Test `tests/test_assistant_graph.py`

- [ ] **Step 1–2: Failing test** — compile with `MemorySaver`; invoke a strong-fit run with `config={"configurable":{"thread_id":"t1"}}`; assert it **pauses** before outreach (no `draft` yet, `status == "awaiting_approval"`), then resume with `Command(resume={"approved": True})` and assert `draft` is produced; resume with `approved=False` ends without a draft.
- [ ] **Step 3: Implement** — insert `interrupt(...)` in a `review_node` before `draft_node`; on resume, branch on the resumed `approved` value (draft vs end). Compile with `MemorySaver()`; expose `build_assistant_graph(checkpointer=...)`.
- [ ] **Step 4–5: Run PASS; `ruff`. Commit** — `feat(agent): human-in-the-loop interrupt before outreach`.

### Task K4: endpoints + API/web wiring
**Files:** Modify `app/main.py`, `app/schemas.py`, `apps/api/src/lib/agent-client.ts`, an API route, `apps/web`; Test `tests/test_endpoints.py`

- [ ] **Step 1–2: Failing test** — `POST /assistant/run` with no provider key → 503 (FastAPI TestClient); with a monkeypatched graph → returns the state incl. `status: "awaiting_approval"` and a `thread_id`.
- [ ] **Step 3: Implement** — `AssistantRunRequest` (description/resume/profile/user_id) + `AssistantResumeRequest` (thread_id, approved). `/assistant/run` builds the graph (module-level singleton + `MemorySaver`), invokes with a generated `thread_id`, returns `{thread_id, state}`; `/assistant/resume` resumes with `Command`. Add `runAssistant`/`resumeAssistant` to `agent-client.ts` (throw `AgentDisabledError` when unset — net-new, no mock), an `/api/ai/assistant/*` route (Clerk + strict limiter + budget), and a minimal web action to start a run and render state + an Approve button.
- [ ] **Step 4–5: Run PASS; `npm run check`; agent `pytest`/`ruff`. Commit** — `feat: application-assistant endpoints + API/web wiring`.

---

## Workstream L — MCP server (standalone)

### Task L1: scaffold + REST bridge + first tool (TDD)
**Files:** Create `services/mcp/requirements.txt`, `services/mcp/api_client.py`, `services/mcp/server.py`, `services/mcp/tests/test_tools.py`

- [ ] **Step 0: Confirm API** — via Context7, confirm MCP Python SDK `FastMCP`, `@mcp.tool()`, and **streamable-HTTP** serving (`mcp.run(transport="streamable-http")` / `mcp.streamable_http_app()`), plus how to require auth.
- [ ] **Step 1–2: Failing test** — `api_client.search_jobs(query, user_id)` calls `GET {BASE}/api/jobs` with `X-API-Key` + `X-User-Id` headers (mock `httpx`/`requests`); returns the parsed list. (Tools are thin wrappers over `api_client`, unit-tested without a live server.)
- [ ] **Step 3: Implement** `api_client.py` — a small REST client reading `MCP_SERVER_API_BASE_URL` + `MCP_SERVER_API_KEY`, with `search_jobs`, `get_job`, `score_fit`, `draft_outreach`, `list_saved_searches` calling the matching API endpoints and forwarding `X-User-Id`. `server.py` — `mcp = FastMCP("jobops")` + `@mcp.tool()` wrappers delegating to `api_client`.
- [ ] **Step 4–5: Run PASS. Commit** — `feat(mcp): JobOps MCP server scaffold + search_jobs over the REST bridge`.

### Task L2: remaining tools + auth + run
**Files:** Modify `services/mcp/server.py`, `api_client.py`; Create `services/mcp/README.md`; Modify `.env.example`
- [ ] Add `get_job`, `score_fit`, `draft_outreach`, `list_saved_searches` tools (each TDD against the mocked REST client). Require auth on the HTTP transport (reject calls without the configured token); the user id is supplied per session/tool arg. Document running it (`python server.py` / uvicorn) and connecting an MCP client (MCP Inspector / Claude) in `README.md`. Add `MCP_SERVER_API_BASE_URL`/`MCP_SERVER_API_KEY` to `.env.example`.
- [ ] **Verify:** `pytest services/mcp/tests`; manual MCP Inspector list/call against a locally-running API. **Commit** — `feat(mcp): full JobOps tool set + auth + run docs`.

---

## Workstream M — Streaming (agent → API → web)

### Task M1: SSE assistant-stream endpoint (TDD)
**Files:** Modify `app/main.py`; Test `tests/test_assistant_stream.py`
- [ ] **Step 0: Confirm API** — via Context7, confirm FastAPI `StreamingResponse(media_type="text/event-stream")` and LangGraph `.astream_events(...)` event shape.
- [ ] **Step 1–2: Failing test** — with a monkeypatched graph whose `astream_events` yields fake node events, `GET/POST /assistant/stream` yields ordered SSE lines (`event: status` … `event: result`). Use FastAPI TestClient streaming.
- [ ] **Step 3: Implement** — an async generator that maps graph events → SSE frames (`f"event: {kind}\ndata: {json}\n\n"`), returned as `StreamingResponse(gen(), media_type="text/event-stream")`; `_require_llm()` guards it.
- [ ] **Step 4–5: Run PASS; `ruff`. Commit** — `feat(agent): SSE streaming of the assistant run`.

### Task M2: Express SSE passthrough
**Files:** Create `apps/api/src/routes/assistant.ts`; Modify `apps/api/src/app.ts`; Test `apps/api/src/routes/assistant.test.ts`
- [ ] **Step 1–2: Failing test** — a `createAssistantRouter({ streamUpstream })` whose route pipes upstream SSE chunks to the response with `Content-Type: text/event-stream` and no buffering; assert the client receives the streamed frames (fake upstream).
- [ ] **Step 3: Implement** — the route sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, fetches the agent stream, and pipes `response.body` to `res`. Mount under `/api/ai/assistant/stream` (Clerk + strict limiter + budget). Confirm no global middleware buffers it.
- [ ] **Step 4–5: Run PASS; `npm run check`. Commit** — `feat(api): SSE passthrough for the assistant stream`.

### Task M3: web live panel + degradation
**Files:** Modify `apps/web`
- [ ] Add an assistant panel that POSTs to `/api/proxy/ai/assistant/stream`, reads the `ReadableStream`, renders per-node status + the streaming draft, and shows the Approve/Reject control at `awaiting_approval` (calling `/assistant/resume`). When the agent is unavailable (503), fall back to the non-streaming run. **Verify:** `npm run check`; manual browser check. **Commit** — `feat(web): live streaming assistant panel + approval`.

---

## Workstream N — MCP client (agent)

### Task N1: MCP tool loader + Tavily fallback (TDD)
**Files:** Create `app/agents/mcp_tools.py`; Modify `app/config.py`; Test `tests/test_mcp_tools.py`
- [ ] **Step 0: Confirm API** — via Context7, confirm `langchain-mcp-adapters` `MultiServerMCPClient` config shape + `get_tools()`.
- [ ] **Step 1–2: Failing test** — `load_research_tools()` returns the Tavily tool when `MCP_CLIENT_SERVERS` is unset (no network); with a monkeypatched MCP client returning fake tools, it returns those (plus/instead of Tavily). Never raises.
- [ ] **Step 3: Implement** — parse `MCP_CLIENT_SERVERS` (JSON), build `MultiServerMCPClient`, `get_tools()`; on empty/error return `[web_search]` (the existing Tavily tool). Add `mcp_client_servers: str | None = None` to `Settings`.
- [ ] **Step 4–5: Run PASS; `ruff`. Commit** — `feat(agent): load external MCP tools with Tavily fallback`.

### Task N2: wire into research + docs
**Files:** Modify `app/agents/runner.py` (and/or `app/graph/assistant.py` research node); Modify `.env.example`; Test `tests/test_mcp_tools.py`
- [ ] Pass `load_research_tools()` into the research agent's `tools=[...]` (replacing the hardcoded `[web_search]`); assert with a fake model that the loaded tools are attached. Add `MCP_CLIENT_SERVERS` to `.env.example` with a comment.
- [ ] **Verify:** `pytest && ruff check app tests`. **Commit** — `feat(agent): research consumes external MCP tools (Tavily fallback)`.

---

## Self-review (spec coverage)
- **K — LangGraph:** K1 (state + routing) · K2 (nodes) · K3 (interrupt/resume) · K4 (endpoints + API/web). ✓ (criteria 1, 2)
- **L — MCP server:** L1 (scaffold + bridge + first tool) · L2 (full tools + auth + docs). ✓ (criterion 3)
- **M — Streaming:** M1 (SSE endpoint) · M2 (Express passthrough) · M3 (web panel + degradation). ✓ (criterion 4)
- **N — MCP client:** N1 (loader + Tavily fallback) · N2 (wire into research). ✓ (criterion 5)
- **Graceful degradation (criterion 6):** 503 path in K4/M1; Tavily fallback in N1; MCP-server auth in L2; web non-streaming fallback in M3. Existing tests preserved.
- **Deferrals honored:** no hybrid-RAG/reranker (P4), no IaC/e2e/load (P5), no agent-graph refactor, no WebSockets.

**Note:** exact third-party SDK APIs (LangGraph `interrupt`/checkpointer/`Command`, MCP `FastMCP` streamable-HTTP + auth, `langchain-mcp-adapters`, FastAPI/Express SSE) and `app/schemas.py` field names are confirmed against the repo + Context7 at the first task of each workstream, before writing code.

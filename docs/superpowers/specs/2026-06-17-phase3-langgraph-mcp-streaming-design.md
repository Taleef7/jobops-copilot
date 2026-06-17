# Design — Phase 3: LangGraph orchestration, MCP, and streaming

**Date:** 2026-06-17
**Status:** Approved (design accepted; scope: all four workstreams — LangGraph application-assistant, MCP server, streaming, MCP client; balanced portfolio-signal / prod-hardening driver)
**Part of:** the "Production-grade AI" program (epic #43). Phase 1 (real data + LLMOps) and Phase 2 (safety, guardrails & eval gating) shipped. This spec covers **Phase 3 only**.

## 1. Why

Phase 1 made the AI observable and measured; Phase 2 made it safe. Phase 3 makes it
**agentic and interoperable** — the advanced-orchestration + interop layer the 2026
market associates with senior AI engineering: a real **stateful LangGraph workflow** with
human-in-the-loop, a live **streaming** UX, and **MCP** in both directions (a hosted
JobOps tool server, and the agent consuming external MCP tools). Both drivers weigh
equally: each piece must read credibly in the portfolio **and** actually work in the live app.

## 2. Goals / non-goals

**Goals**
- **K** — A LangGraph **application-assistant**: a stateful graph composing parse → score →
  (conditional) research → draft-outreach, with conditional edges and a human-in-the-loop
  interrupt before outreach.
- **L** — A remote, authenticated **MCP server** exposing JobOps as tools (a bridge over
  the existing REST API).
- **M** — End-to-end **streaming** (SSE) of the assistant run to the web UI.
- **N** — The agent as an **MCP client**: the research step consumes external MCP tools,
  with graceful fallback to the current Tavily tool.

**Non-goals (deferred to later phases)**
- Hybrid retrieval / reranker / fine-tuning (Phase 4).
- IaC / full Dockerization / e2e / caching / load test (Phase 5).
- Refactoring the existing Phase 8 agents into explicit graphs (the new assistant graph is
  the LangGraph showcase; `create_agent` is already LangGraph-backed).
- WebSockets / bidirectional streaming (SSE is sufficient for server→client).

## 3. Success criteria (acceptance)
1. `POST /assistant/run` executes the graph **parse → score → (if fit ≥ threshold) research →
   draft-outreach**, returns the accumulated state, and **pauses at a human-in-the-loop
   interrupt** before outreach; `POST /assistant/resume` continues only on explicit approval.
   Below-threshold fit short-circuits to a "pass" result without research/outreach.
2. The graph **reuses the existing guarded chains/agents as nodes**, so Phase 2 guards
   (PII redaction, injection defense, output moderation) still apply.
3. A remote **MCP server** exposes `search_jobs`, `get_job`, `score_fit`, `draft_outreach`,
   and `list_saved_searches`; it requires auth and acts as the supplied user; an MCP client
   (e.g. MCP Inspector / Claude) can list and call the tools end to end.
4. The web UI **streams** an assistant run live (per-node status + token deltas) via SSE
   through an API passthrough, and surfaces the approval control at the interrupt.
5. The research step **loads tools from a configured external MCP server** and uses them;
   with none configured it falls back to the Tavily `web_search` tool — no regression.
6. **Graceful degradation preserved:** no provider key → assistant/stream endpoints 503 and
   the UI uses the existing non-streaming flow; no MCP client server → Tavily fallback; the
   MCP server refuses unauthenticated calls. `npm run check` + agent `pytest`/`ruff` stay green.

## 4. Workstream K — LangGraph application-assistant (`services/agent`)

- **Graph (`app/graph/assistant.py`):** a `StateGraph` over an `AssistantState`
  (`description_text`, `resume_text`, `profile_text`, `user_id`, `parsed`, `fit`,
  `research`, `draft`, `approved`, `status`). Nodes wrap the **existing** functions:
  `parse_job` → `score_fit` → `run_research` → `draft_outreach`.
- **Conditional edges:** after scoring, route on `fit.fit_score ≥ ASSISTANT_FIT_THRESHOLD`
  (default 60): strong → research → outreach; weak → END with an honest "pass" summary.
- **Human-in-the-loop:** a LangGraph `interrupt` (with a checkpointer, in-memory for now)
  **before** the outreach node — the run pauses and returns its proposed plan/draft inputs;
  `/assistant/resume` (with `approved=true`) continues to draft-outreach, else ends.
- **Endpoints (`app/main.py`):** `POST /assistant/run` and `POST /assistant/resume`
  (thread id ties a run to its checkpoint). `_require_llm()` guards both. Nodes call the
  Phase-2-guarded chains, so PII/injection/moderation are inherited.
- **Rejected:** refactoring the existing agents into graphs (less new capability); a
  monolithic chain instead of a graph (loses conditional routing + interrupt).

## 5. Workstream L — MCP server (`services/mcp`, standalone)

- **A remote, streamable-HTTP MCP server** (official MCP Python SDK / FastMCP) in a new
  `services/mcp/`. Tools: `search_jobs`, `get_job`, `score_fit`, `draft_outreach`,
  `list_saved_searches`.
- **Bridge over the REST API:** each tool calls the existing `apps/api` HTTP endpoints
  (language-agnostic; reuses every store, guard, and rate-limit) rather than touching the
  DB. The server holds the API base URL + shared API key; the MCP client supplies the
  **user id** so a session acts as that user.
- **Auth:** unauthenticated tool calls are refused; the server forwards `X-API-Key`
  (shared secret) + `X-User-Id` to the API. Configured via `MCP_SERVER_*` env.
- **Rejected:** a DB-direct server (duplicates store logic, bypasses Phase 2 guards) and a
  stdio-only server (not usable by the live app remotely; HTTP can still run locally).

## 6. Workstream M — Streaming (agent → API → web)

- **Agent:** `POST /assistant/stream` returns `text/event-stream` (FastAPI
  `StreamingResponse`) driven by the graph's `.astream_events()` — emits per-node **status**
  events and **token deltas** for generative steps, then a final `result` event.
- **API:** an Express passthrough route (`/api/ai/assistant/stream`) that streams the
  agent's SSE through unbuffered, Clerk-auth'd, under the Phase 2 rate-limit/budget guards.
- **Web:** a live assistant panel consuming the stream (fetch `ReadableStream` / SSE),
  rendering step progress + the streaming draft, with the approval control at the interrupt.
- **Degradation:** no agent/provider → 503; the UI keeps the existing non-streaming flow.
- **Rejected:** WebSockets (heavier; SSE suffices and works on App Service).

## 7. Workstream N — MCP client (`services/agent`)

- The **research** path loads tools from a configured external MCP server via
  **`langchain-mcp-adapters`** and hands them to the agent/graph alongside (or instead of)
  the Tavily tool. Server list is config-driven (`MCP_CLIENT_SERVERS`).
- **Degradation:** no MCP server configured or reachable → fall back to the current Tavily
  `web_search` tool; no regression to existing research behavior.
- **Rejected:** hardcoding a single vendor MCP (brittle); making MCP mandatory (breaks the
  no-key/offline guarantee).

## 8. Cross-cutting

- **Config/secrets (no real values in `.env.example`):** `ASSISTANT_FIT_THRESHOLD`;
  `MCP_SERVER_API_BASE_URL` + `MCP_SERVER_API_KEY` (L); `MCP_CLIENT_SERVERS` (N). Live
  values via App Service config (existing pattern).
- **Testing:** K — graph routing (strong/weak fit) + interrupt/resume with a fake model
  (no LLM); L — each MCP tool handler against a mocked REST API + the auth-required path;
  M — the SSE endpoint emits ordered events from a fake graph + the Express passthrough; N —
  MCP-client tool loading with a mock adapter + the Tavily fallback. Preserve all existing
  graceful-degradation tests; `npm run check` + agent `pytest`/`ruff` green.
- **Docs:** ARCHITECTURE (orchestration + MCP + streaming), README highlight, ROADMAP
  Phase 3, and a `services/mcp/README.md` (how to connect an MCP client).

## 9. Risks & mitigations
- **LangGraph interrupt/checkpointer complexity** → in-memory checkpointer + a thread id;
  confirm the v1 `interrupt`/`Command(resume=...)` API via Context7 before coding.
- **Streaming on App Service** → SSE (not WebSockets); ensure the Express proxy disables
  buffering/compression on the stream route.
- **MCP auth** → the server never exposes the DB; it forwards the shared API key + user id
  to the already-guarded REST API, and refuses unauthenticated calls.
- **Shared-file conflicts across K/M/N** → they touch the agent/graph, so build sequentially
  (K→M→N), each branched off `main` after the prior merges; **L is independent** and
  parallel-safe. (Lesson from Phase 2's J-branched-off-H mistake.)
- **Scope** → four sizeable workstreams; each is independently shippable (one PR each) and
  degrades gracefully, keeping the phase manageable.

## 10. SDLC / delivery
This spec → an implementation plan (`writing-plans`) → **detailed GitHub issues**: an
**epic** ("Phase 3 — LangGraph, MCP & streaming") plus four **sub-issues** (K LangGraph,
L MCP server, M streaming, N MCP client), each with acceptance criteria and task
checklists, under a **`Phase 3` milestone** with labels. Each sub-issue is delivered on its
own branch → PR (`Closes #…`) → green CI → **user merges**; K→M→N sequential, L parallel.
TDD where it fits; `npm run check` + agent `pytest`/`ruff` before every PR. Exact
third-party SDK APIs confirmed via Context7 at the first task of each workstream.

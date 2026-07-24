# Roadmap

## Status Summary

- Phase 0: complete
- Phase 1: complete
- Phase 2: complete
- Phase 3: complete
- Phase 4: complete
- Phase 5: complete
- Phase 6: complete — web/API/agent hosted on Azure and the cloud Postgres (incl. pgvector) is fully migrated; the optional hardening (Application Insights monitoring + Key Vault secret references) is also in place
- Phase 7: complete (Zapier + Make companion flows built and live, with screenshots)
- Phase 8: complete (advanced agents)
- Phase 9: complete (real LLM integration and Python agent service)
- Phase 10: complete (RAG and vector search)
- Phase 11: complete (time-series telemetry intelligence)

The AI-agent push ran Phase 9 -> Phase 10 -> Phase 8 -> Phase 11 -> Phase 6, all
landed. Phase 7 (Zapier + Make companion flows) is now complete as well.

On top of the original 0–11 plan, the **production-grade AI program** (epics #43 → #51 →
#61 → #70 → #76) is **fully complete** — its Phases 1–5 (LLMOps backbone, safety/guardrails,
LangGraph+MCP+streaming, hybrid retrieval+reranker+eval, operational hardening) all landed.
See the dedicated section below.

The **product overhaul** (epic #124, merged to `main` 2026-06-25) is also **complete** — its
six phases (truthful data, JobRight-style jobs feed, add-job URL autofill, persistent agent
outputs, global assistant widget, Clerk-consolidated profile) all landed. See the dedicated
section below; two owner-gated deploy follow-ups (#141, #142) remain.

## Phase 0: Project Foundation

Done:

- repo structure
- frontend scaffold
- API scaffold
- SQL drafts
- prompt templates
- docs and sample data

## Phase 1: CRM MVP

Done:

- persistent job CRUD
- jobs list
- job detail
- status updates
- notes and priority editing

## Phase 2: AI Parsing And Fit Scoring

Done:

- parse-job endpoint
- score-fit endpoint
- structured LLM outputs
- job analysis persistence
- analysis actions on the job detail page
- Azure PostgreSQL bootstrap support

## Phase 3: Outreach Drafting

Done:

- draft-outreach endpoint integration into the UI
- outreach review and approval workflow
- persisted outreach drafts
- manual approved, sent, and skipped status controls
- optional Gmail draft support behind a feature flag, browser-verified locally

## Phase 4: n8n Integration

Complete:

- webhook-driven processing
- daily job discovery workflow scaffolding
- weekly report automation endpoint integration
- follow-up reminders endpoint integration
- sample export JSON files and workflow docs
- local n8n runtime validation pass with screenshots and evidence

## Phase 5: Weekly Reporting

Complete:

- report storage
- report dashboards
- Blob Storage report exports
- weekly report API and n8n workflow persistence

## Phase 6: Azure Deployment

Complete:

- Azure PostgreSQL in place and verified; full schema migrated, including the
  `pgvector` embeddings store (extension v0.8.2 + `embeddings` table + vector
  index applied to the cloud DB on 2026-06-10)
- web (Next.js standalone) deployed on Azure App Service
- API (Express) deployed on Azure App Service, running in `postgres` mode
- Python agent service deployed on Azure Container Apps (consumption, scale-to-zero)
- application settings / secrets configured on the App Service and Container App
- deployment screenshots captured in `docs/design/`

Optional hardening (also complete):

- Application Insights monitoring/tracing across web, API, and agent
  (`jobops-insights` + Log Analytics `jobops-logs`, 1 GB/day cap)
- Key Vault (`jobops-kv`, RBAC) serving the App Service secrets as
  managed-identity references (the agent Container App keeps its native
  secret store by design)

## Phase 7: Zapier And Make

Complete:

- Zapier flow (Google Sheets new/updated row -> Google Calendar follow-up reminder),
  built, tested, and published live (`docs/design/phase7/zapier-zap.png`)
- Make scenario (Webhook -> API `/api/n8n/job-intake` -> email notification),
  built and run end to end (`docs/design/phase7/make-scenario.png`)
- importable blueprint + setup guides under `workflows/make` and `workflows/zapier`,
  with comparison notes in `docs/AUTOMATION_WORKFLOWS.md`

## Phase 8: Advanced Agents

Complete:

- interview prep agent
- hiring manager / company research agent (tool use + web search)
- skill gap planning agent
- agent runs surfaced in the dashboard (per-agent tabs on the job detail page)

## Phase 9: Real LLM Integration And Python Agent Service

Complete:

- `services/agent` FastAPI microservice
- provider-agnostic LLM router (Anthropic Claude, Azure OpenAI, Gemini)
- real LLM calls for parse-job, score-fit, draft-outreach, and weekly recommendations
- structured-output validation
- TS API delegation via `agent-client.ts` with a deterministic mock fallback

## Phase 10: RAG And Vector Search

Complete:

- pgvector on Azure PostgreSQL and an `embeddings` table (live on the cloud DB)
- Hugging Face sentence-transformers embeddings (PyTorch, CPU-only)
- retrieval-augmented, user-scoped fit scoring grounded in resume evidence

## Phase 11: Time-Series Telemetry Intelligence

Complete:

- pipeline time-series metrics over the CRM (pandas)
- trend/anomaly detection and lightweight forecasting
- LLM-narrated insights endpoint (retained in `services/agent` for demos)
- synthetic EV battery/sensor telemetry demo

---

## Production-grade AI program (beyond the original 0–11 plan)

A separate hardening initiative (epics #43 → #51 → #61 → #70 → #76, **all complete**) that
turns *"I built an AI app"* into *"I operate AI on real data with tracing, evals, guardrails,
agentic orchestration, measured retrieval, and tested infrastructure."* Numbered
**independently** of the phases above (its "Phase 1/2" are not the original Phases 1/2).
Design + plans live under `docs/superpowers/specs|plans/`.

### Phase 1 — Real data + LLMOps backbone (complete)

- Real job ingestion from **Adzuna** (+ no-key Remotive fallback), per-user saved
  searches, and dedup (#44).
- **Langfuse** tracing of every agent LLM/RAG call (tokens/cost/latency); no-op without
  keys (#45).
- **Eval harness**: deterministic parse-job metrics + Ragas score-fit on a real gold set,
  report-only CI seed (#46).

### Phase 2 — Safety, guardrails & eval gating (complete, epic #51)

- **API edge** (#53): per-user/IP rate limiting + per-user daily AI cost ceiling + `helmet`.
- **PII** (#54): strip contact-PII before third-party LLMs and mask it in Langfuse traces.
- **Eval gating** (#55): key-free PR gate (integrity + mock-model smoke) + a main quality
  gate (thresholds + Ragas regression) + full `EVALS.md`.
- **LLM I/O guardrails** (#56): prompt-injection defense (scan + delimit) + provider-agnostic
  output moderation + groundedness check on drafted outreach.

### Phase 3 — LangGraph + MCP + streaming (complete, epic #61)

- **LangGraph application-assistant** (#63): a stateful graph that scores fit, then (above a
  threshold) researches + drafts outreach, else stops with a "pass".
- **End-to-end SSE streaming** (#64) of the assistant run to the dashboard.
- **JobOps MCP server** (#65): FastMCP REST bridge exposing the agent's tools over MCP.
- **Agent as MCP client** (#66): the research agent consumes external MCP tools (Tavily fallback).

### Phase 4 — Hybrid retrieval, reranker & retrieval eval (complete, epic #70)

- **Hybrid retrieval** (#67): pgvector dense + Postgres full-text fused via Reciprocal Rank
  Fusion, with graceful vector-only fallback.
- **CPU cross-encoder reranker** (#68): opt-in, graceful, no new dependency.
- **Retrieval-mode eval** (#69): off/vector/hybrid/hybrid+rerank downstream delta; results in
  `EVALS.md`. **Fine-tuning was dropped** (CPU-only infra; needs labeled data + GPU).
  **Corrected twice — see the notices in `EVALS.md`.** The original "≈3× faithfulness"
  headline was withdrawn (#197: the harness leaked the resume to the generator in every arm,
  so the baseline was never resume-blind), and the first re-measurement was itself invalid
  (#198: the gold resume chunked into 4 pieces at `k=4`, so retrieval selected nothing, and
  the lexical side matched 0/16 JDs). With both fixed, the standing result is that **top-k
  retrieval outranks the whole resume** (0.726 vs 0.586 Spearman, 2.2× the replicate-derived
  noise floor) — extra context dilutes the fit signal — while hybrid and reranking remain
  unresolved against plain vector.

### Phase 5 — Operational hardening (complete, epic #76)

- **Caching** (#77): in-process TTL cache for job search (cuts redundant Adzuna calls) — and the
  API's `node:test` suite wired into CI (it wasn't run before).
- **IaC** (#78): Bicep codifying the live Azure topology (App Service web/api, Container App
  agent, Postgres, App Insights, Key Vault); CI-validated via `az bicep build` and `what-if`-verified
  against the live subscription.
- **Load test** (#79): k6 script for the API read path with pass/fail thresholds (verified
  against the live API).
- **e2e** (#80): Playwright smoke tests for the web public surface + protected-route redirect
  (verified locally and against the deployed web).

### Operational follow-ups (owner-gated, optional — by design, not gaps)

Intentionally scoped as manual/credentialed steps in the Phase 5 plan, not required deliverables:

- **Apply the Bicep** — authored + `what-if`-verified, but a real `az deployment group create`
  against the live `projects` RG is intentionally manual (it would rewrite live app settings, and
  the live apps use Key Vault references the template simplifies). *Recommendation:* keep it as a
  validated reference; only `create` against a fresh greenfield RG for a from-scratch proof.
- **k6 in CI** — k6 is a separate binary needing a running target, so it runs on demand
  (`npm run loadtest`). *Recommendation:* optionally add a manual/scheduled workflow that installs
  k6 and smoke-tests the deployed API.
- **Activate the CI e2e job** — gated; skips green until `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` +
  `CLERK_SECRET_KEY` are set as repo secrets. *Recommendation:* add Clerk test-instance keys to run
  e2e on PRs.

---

## Product overhaul (epic #124, complete)

A product-quality overhaul (epic #124, merged to `main` 2026-06-25) that takes the app from
"works end to end" to a credible JobRight-style product: truthful surfaced data, in-app job
discovery, frictionless job intake, persisted agent work, a global assistant, and identity fully
on Clerk. Six phases (#118 → #123), **all complete and merged**, plus cleanup PR #140.

### Phase 1 — Truthful data & quick correctness fixes (#118, complete)

- Dashboard/cards driven by **live aggregates** instead of stand-in numbers, real empty states,
  the **Parse** step folded into **Score-fit**, and a single canonical outreach draft.

### Phase 2 — JobRight-style Jobs feed (#119, complete)

- In-app job discovery on **/jobs**: pre-rank on ingest + an LLM fit score computed on open, a
  recency filter, and a scheduled discovery cron feeding the feed.

### Phase 3 — Add-job URL autofill (#120, complete)

- `POST /api/jobs/extract` — an SSRF-guarded tiered extractor that autofills the add-job form
  from a pasted posting URL.

### Phase 4 — Persistent AI agent outputs (#121, complete)

- Migration `008_agent_outputs.sql` (`agent_outputs` table) + `GET /api/jobs/:id/agent-outputs`;
  the UI gains **Regenerate** plus generated-at / model metadata so agent runs persist across visits.

### Phase 5 — Global floating assistant widget (#122, complete)

- `POST /api/ai/assistant/chat` (streamed) backing a multi-turn, context-aware floating assistant
  with `sessionStorage` persistence and accessible behavior.

### Phase 6 — Profile management consolidated on Clerk (#123, complete)

- Migration `009_drop_display_name.sql` drops `user_profiles.display_name`; identity (name/avatar/
  email) comes from Clerk via `currentUser()`, while `profile_text` grounding is kept.

### Open follow-ups (owner-gated, not done)

- **#141 — Deploy/activate:** activate the agent Container App revision that includes
  `/assistant/chat`, and apply migration `009` to the production DB.
- **#142 — Cold-start resilience:** harden the streaming endpoints against cold starts on the
  scale-to-zero agent.

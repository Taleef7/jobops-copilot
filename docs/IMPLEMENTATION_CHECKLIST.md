# Implementation Checklist

The AI-agent push is complete. Real LLM integration (Phase 9), retrieval-augmented
analysis (Phase 10), advanced agents (Phase 8), telemetry intelligence (Phase 11),
and live Azure deployment (Phase 6) have all landed, in that order.

Phase 7 (Zapier/Make companion flows) is now complete as well — both flows are
built, tested, and live, with screenshots captured.

The **product overhaul** (epic #124) is also complete — all six phases (#118–#123)
plus cleanup PR #140 merged to `main` on 2026-06-25. Two owner-gated deploy
follow-ups (#141, #142) remain; see the bottom of this file.

## Phase 4: n8n Integration

- [x] Bring up the local n8n runtime against the JobOps API.
- [x] Import the `job-intake`, `follow-up-reminders`, and `weekly-report` workflow exports.
- [x] Verify `N8N_WEBHOOK_SECRET`, `JOBOPS_API_BASE_URL`, and webhook round-trips.
- [x] Capture screenshots of the live imported workflows.
- [x] Finalize the workflow review notes and supporting docs.

## Phase 9: Real LLM Integration and Python Agent Service

- [x] Scaffold the `services/agent` FastAPI microservice.
- [x] Add a provider-agnostic LLM router (Anthropic Claude, Azure OpenAI, Gemini).
- [x] Port parse-job, score-fit, draft-outreach, and weekly recommendations to real LLM calls with structured-output validation.
- [x] Delegate from the TS API via `agent-client.ts` when `AGENT_SERVICE_URL` is set, keeping the deterministic mock as a fallback.
- [x] Add Python unit tests and wire the service into local dev.

## Phase 10: RAG and Vector Search

- [x] Enable `pgvector` on Azure PostgreSQL and add the `embeddings` table migration.
- [x] Embed resumes and job descriptions with Hugging Face sentence-transformers (PyTorch).
- [x] Store and query embeddings via pgvector cosine similarity.
- [x] Make fit scoring and outreach drafting retrieval-augmented and grounded in retrieved resume evidence.

## Phase 8: Advanced Agents

- [x] Build the interview prep agent.
- [x] Build the hiring manager / company research agent (tool use + web search).
- [x] Build the skill-gap planning agent.
- [x] Surface agent runs in the dashboard UI.

## Phase 11: Time-Series Telemetry Intelligence

- [x] Compute pipeline time-series metrics (pandas) over the CRM.
- [x] Detect trends/anomalies and add a lightweight forecast.
- [x] Add an LLM-narrated insights endpoint and dashboard chart.
- [x] (Stretch) Synthetic EV battery/sensor telemetry demo proving the pattern transfers to vehicle data.

## Phase 6: Azure Deployment

- [x] Provision the dashboard hosting target. (Azure App Service, Next.js standalone)
- [x] Provision the API hosting target. (Azure App Service, `postgres` mode)
- [x] Provision the Python agent service hosting target. (Azure Container Apps, scale-to-zero)
- [x] Apply the full cloud Postgres schema, including the `pgvector` embeddings migration. (verified 2026-06-10)
- [x] Wire application settings and secrets management on the hosting targets.
- [x] Capture deployment screenshots.
- [x] (Optional hardening) Add monitoring and tracing (Application Insights) + Key Vault. (`jobops-insights` across web/API/agent; `jobops-kv` serving App Service secrets via managed identity, 2026-06-10)

## Phase 7: Zapier and Make

- [x] Build one Zapier flow (Sheets row -> Calendar follow-up reminder, published live).
- [x] Build one Make scenario (Webhook -> API `/api/n8n/job-intake` -> email).
- [x] Write the comparison notes and capture screenshots.

## Product Overhaul (epic #124)

### Phase 1: Truthful data & quick correctness fixes (#118)

- [x] Drive the dashboard/cards from live aggregates and add real empty states.
- [x] Fold the Parse step into Score-fit.
- [x] Reduce outreach to a single canonical draft.

### Phase 2: JobRight-style Jobs feed (#119)

- [x] Add in-app job discovery on `/jobs`.
- [x] Pre-rank jobs on ingest and compute an LLM fit score on open.
- [x] Add a recency filter.
- [x] Add a scheduled discovery cron feeding the feed.

### Phase 3: Add-job URL autofill (#120)

- [x] Add `POST /api/jobs/extract`, an SSRF-guarded tiered extractor.
- [x] Autofill the add-job form from a pasted posting URL.

### Phase 4: Persistent AI agent outputs (#121)

- [x] Add migration `008_agent_outputs.sql` (`agent_outputs` table).
- [x] Add `GET /api/jobs/:id/agent-outputs`.
- [x] Add a Regenerate action with generated-at / model metadata.

### Phase 5: Global floating assistant widget (#122)

- [x] Add `POST /api/ai/assistant/chat` (streamed).
- [x] Build a multi-turn, context-aware floating widget with `sessionStorage` persistence and a11y.

### Phase 6: Profile management consolidated on Clerk (#123)

- [x] Add migration `009_drop_display_name.sql` (drops `user_profiles.display_name`).
- [x] Source identity from Clerk via `currentUser()`; keep `profile_text` grounding.

### Cleanup

- [x] PR #140: structured assistant stream returns 503 (not 500) when the agent is disabled.

### Open follow-ups (owner-gated, not done)

- [ ] #141: activate the agent Container App revision that includes `/assistant/chat` and apply migration `009` to the prod DB.
- [ ] #142: cold-start resilience for the streaming endpoints on the scale-to-zero agent.

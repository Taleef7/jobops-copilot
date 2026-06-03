# Implementation Checklist

This checklist tracks the remaining implementation work in execution order.
Phase 4 runtime validation is complete. The active push reorders the remaining
work to land a genuinely AI-powered, agentic, deployed product: real LLM
integration (Phase 9) and retrieval-augmented analysis (Phase 10) come first
because they unblock the advanced agents (Phase 8), the telemetry intelligence
(Phase 11), and the live Azure deployment (Phase 6).

Execution order: Phase 9 → Phase 10 → Phase 8 → Phase 11 → Phase 6.
Phase 7 (Zapier/Make) is deferred and out of scope for the current push.

## Phase 4: n8n Integration

- [x] Bring up the local n8n runtime against the JobOps API.
- [x] Import the `job-intake`, `follow-up-reminders`, and `weekly-report` workflow exports.
- [x] Verify `N8N_WEBHOOK_SECRET`, `JOBOPS_API_BASE_URL`, and webhook round-trips.
- [x] Capture screenshots of the live imported workflows.
- [x] Finalize the workflow review notes and supporting docs.

## Phase 9: Real LLM Integration and Python Agent Service

- [ ] Scaffold the `services/agent` FastAPI microservice.
- [ ] Add a provider-agnostic LLM router (Anthropic Claude, Azure OpenAI, Gemini).
- [ ] Port parse-job, score-fit, draft-outreach, and weekly recommendations to real LLM calls with structured-output validation.
- [ ] Delegate from the TS API via `agent-client.ts` when `AGENT_SERVICE_URL` is set, keeping the deterministic mock as a fallback.
- [ ] Add Python unit tests and wire the service into local dev.

## Phase 10: RAG and Vector Search

- [ ] Enable `pgvector` on Azure PostgreSQL and add the `embeddings` table migration.
- [ ] Embed resumes and job descriptions with Hugging Face sentence-transformers (PyTorch).
- [ ] Store and query embeddings via pgvector cosine similarity.
- [ ] Make fit scoring and outreach drafting retrieval-augmented and grounded in retrieved resume evidence.

## Phase 8: Advanced Agents

- [ ] Build the interview prep agent.
- [ ] Build the hiring manager / company research agent (tool use + web search).
- [ ] Build the skill-gap planning agent.
- [ ] Surface agent runs in the dashboard UI.

## Phase 11: Time-Series Telemetry Intelligence

- [ ] Compute pipeline time-series metrics (pandas) over the CRM.
- [ ] Detect trends/anomalies and add a lightweight forecast.
- [ ] Add an LLM-narrated insights endpoint and dashboard chart.
- [ ] (Stretch) Synthetic EV battery/sensor telemetry demo proving the pattern transfers to vehicle data.

## Phase 6: Azure Deployment

- [ ] Provision the dashboard hosting target.
- [ ] Provision the API hosting target.
- [ ] Provision the Python agent service hosting target.
- [ ] Wire Blob Storage, application settings, and secrets management.
- [ ] Add monitoring and tracing (Application Insights).
- [ ] Capture deployment screenshots.

## Phase 7: Zapier and Make (deferred)

- [ ] Build one Zapier flow.
- [ ] Build one Make scenario.
- [ ] Write the comparison notes and capture screenshots.

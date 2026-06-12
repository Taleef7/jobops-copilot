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

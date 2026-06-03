# Roadmap

## Status Summary

- Phase 0: complete
- Phase 1: complete
- Phase 2: complete
- Phase 3: complete
- Phase 4: complete
- Phase 5: complete
- Phase 6: partial, because Azure PostgreSQL is complete but app hosting is still pending
- Phase 7: deferred (Zapier/Make companion flows, out of scope for the current push)
- Phase 8: planned (advanced agents)
- Phase 9: planned (real LLM integration and Python agent service)
- Phase 10: planned (RAG and vector search)
- Phase 11: planned (time-series telemetry intelligence)

Active execution order for the current push: Phase 9 -> Phase 10 -> Phase 8 -> Phase 11 -> Phase 6.

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

Partial:

- Azure PostgreSQL is in place and verified
- App Service deployment workflow scaffold is now in the repo
- full static web app or app hosting still needs to be deployed
- API hosting still needs to be deployed
- Blob Storage, monitoring, and secrets management still need to be wired in

## Phase 7: Zapier And Make

Deferred (out of scope for the current push):

- one Zapier flow
- one Make scenario
- screenshots and comparison notes

## Phase 8: Advanced Agents

Planned:

- interview prep agent
- hiring manager / company research agent (tool use + web search)
- skill gap planning agent
- agent runs surfaced in the dashboard

## Phase 9: Real LLM Integration And Python Agent Service

Planned:

- `services/agent` FastAPI microservice
- provider-agnostic LLM router (Anthropic Claude, Azure OpenAI, Gemini)
- real LLM calls for parse-job, score-fit, draft-outreach, and weekly recommendations
- structured-output validation
- TS API delegation via `agent-client.ts` with a deterministic mock fallback

## Phase 10: RAG And Vector Search

Planned:

- pgvector on Azure PostgreSQL and an embeddings table
- Hugging Face sentence-transformers embeddings (PyTorch)
- retrieval-augmented fit scoring and outreach drafting grounded in resume evidence

## Phase 11: Time-Series Telemetry Intelligence

Planned:

- pipeline time-series metrics over the CRM (pandas)
- trend/anomaly detection and lightweight forecasting
- LLM-narrated insights endpoint and dashboard chart
- stretch: synthetic EV battery/sensor telemetry demo

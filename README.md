# JobOps Copilot

[![CI](https://github.com/Taleef7/jobops-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/Taleef7/jobops-copilot/actions/workflows/ci.yml)
[![Live demo](https://img.shields.io/badge/demo-live-059669)](https://jobops-web.azurewebsites.net)
![Next.js](https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-20232a?logo=react&logoColor=61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776ab?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![LangChain](https://img.shields.io/badge/LangChain-agents-1c3c3c?logo=langchain&logoColor=white)
![Azure](https://img.shields.io/badge/Azure-App%20Service%20%2B%20Container%20Apps-0078d4?logo=microsoftazure&logoColor=white)
![pgvector](https://img.shields.io/badge/Postgres-pgvector-4169e1?logo=postgresql&logoColor=white)
![Human in the loop](https://img.shields.io/badge/AI-human--in--the--loop-7c3aed)

**An AI-agent operations platform for the job search.** JobOps Copilot tracks
opportunities in a CRM, then uses real LLMs, retrieval-augmented generation, and
multi-step agents to analyze fit, research companies, prep interviews, plan
skill gaps, draft outreach, and surface time-series insights — with a human in
the loop at every critical step.

It is intentionally a **responsible AI operations system, not an auto-apply
bot**: it drafts and recommends, but never sends or fabricates.

> **Live on Azure:** dashboard → https://jobops-web.azurewebsites.net ·
> API health → https://jobops-api.azurewebsites.net/api/health
> (Web + API run on Azure App Service against Azure PostgreSQL; the Python agent
> runs on Azure Container Apps, scale-to-zero, and is warmed on demand for live
> AI demos via `scripts/azure/demo.sh warm`. When the agent is cold or
> unattached, the cloud app degrades gracefully to the deterministic analysis.)

![JobOps Copilot system architecture — browser to Next.js web to Express API to Python FastAPI agent (LangChain, RAG, telemetry) to Azure Postgres with pgvector, plus Blob Storage, Hugging Face embeddings, n8n/Make/Zapier automation, and Azure platform services](docs/architecture/architecture-blueprint.svg)

> 🔎 **Interactive version** (pan · zoom · click any node):
> [`/architecture`](https://jobops-web.azurewebsites.net/architecture) on the live app.

## Highlights

- **Real, multi-provider LLMs** — a Python agent service routes to Anthropic
  Claude, Azure OpenAI, OpenAI, or Google Gemini (LangChain `init_chat_model`),
  with structured-output validation. Falls back to a deterministic mock when no
  key is set, so the app always works.
- **Multi-step LangChain agents** — interview-prep, company research (with a
  web-search **tool**), and skill-gap planning, built on `create_agent` +
  `ToolStrategy` for provider-agnostic structured output.
- **RAG over pgvector** — resumes/JDs are embedded with Hugging Face
  sentence-transformers (PyTorch) and stored in Postgres `pgvector`; fit scoring
  is grounded in retrieved resume evidence.
- **Time-series telemetry intelligence** — pandas trend/anomaly/forecast over
  the pipeline, narrated by an LLM, plus a synthetic **EV battery telemetry**
  demo showing the same analysis transfers to vehicle sensor data.
- **Modern, responsive UI** — Next.js 16 + Tailwind v4 + shadcn/ui (Base UI),
  light/dark themes, a marketing landing page, and **Clerk authentication** with
  protected routes. Visual-first: fit-score rings, status pills, skill chips,
  sparklines, and a kanban outreach board. Verified with Playwright across
  breakpoints.
- **Workflow automation** — n8n webhooks for job intake, follow-up reminders,
  and weekly reports. Companion flows for Make.com (webhook → API → email) and
  Zapier (sheet row → calendar reminder) are ready to import/build.
- **Production discipline** — npm + Python CI (lint, typecheck, build, tests),
  protected `main`, Azure PostgreSQL, Blob Storage export, and an App Service
  deploy workflow.
- **Production-grade AI ops** — real **Adzuna** job ingestion (no-key fallback),
  **Langfuse** tracing of every LLM/RAG call, an **eval harness** (deterministic +
  Ragas) with a two-tier CI **gate**, and runtime **guardrails**: per-user
  rate-limiting + daily cost ceiling, contact-PII redaction (before the LLM and in
  traces), prompt-injection defense, and output moderation. All degrade gracefully
  without keys. See [docs/ROADMAP.md](docs/ROADMAP.md), [EVALS.md](EVALS.md), and
  [docs/PRIVACY.md](docs/PRIVACY.md).

## Architecture

The **system diagram at the top of this README** (source:
[`docs/architecture/architecture-blueprint.svg`](docs/architecture/architecture-blueprint.svg))
shows the full topology. In short: `apps/web` (Next.js) → `apps/api` (Express) →
`services/agent` (Python/FastAPI, which owns the real AI) → Azure PostgreSQL +
`pgvector`, with Blob Storage, automation, and Azure platform services around it.

- `apps/web` — dashboard and product UI (jobs, outreach, reports, AI agents, telemetry).
- `apps/api` — Express API: CRUD, AI proxy routes, n8n webhooks, telemetry. Delegates AI to the agent service when `AGENT_SERVICE_URL` is set, else uses a mock.
- `services/agent` — **Python FastAPI** service: real LLM chains, RAG, LangChain agents, and telemetry analysis. See [services/agent/README.md](services/agent/README.md).
- `db/migrations` — PostgreSQL schema (incl. `pgvector` embeddings table).
- `prompts` — canonical prompt templates.
- `workflows` — n8n/Zapier/Make automation docs and exports.

A full walkthrough is in **[docs/DEMO.md](docs/DEMO.md)**; design detail in
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Tech stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind v4, shadcn/ui (Base UI), next-themes, Clerk auth.
- **API:** Express 4, TypeScript, `pg`.
- **Agent service:** Python 3.12, FastAPI, LangChain, sentence-transformers (PyTorch), pandas, psycopg/pgvector.
- **Data/cloud:** Azure Database for PostgreSQL (+ pgvector), Azure Blob Storage, Azure App Service.
- **Automation:** n8n (primary orchestrator, self-hosted), Make.com (hosted webhook-to-API scenario), Zapier (2-step sidecar).

## Automation tiers

Three automation tools cover different points in the free-tier / complexity space. See [docs/AUTOMATION_WORKFLOWS.md](docs/AUTOMATION_WORKFLOWS.md) for the full comparison and the n8n vs Make vs Zapier decision guide.

- **n8n** — self-hosted, full orchestration, unlimited ops. The primary pipeline: job intake, fit scoring, follow-up reminders, weekly reports. Setup: [workflows/n8n/README.md](workflows/n8n/README.md).
- **Make.com** — hosted SaaS, 1,000 ops/month free, custom webhooks and HTTP calls free. Runs the same webhook → `/api/n8n/job-intake` → email-notification flow as n8n, without a server to manage. Blueprint ready to import: [workflows/make/setup.md](workflows/make/setup.md).
- **Zapier** — hosted SaaS, 100 tasks/month free, 2-step Zaps only on the free plan (no webhooks). A lightweight sidecar: adds a Google Calendar follow-up reminder whenever you add a row to your Jobs tracking sheet. Zap ready to build: [workflows/zapier/setup.md](workflows/zapier/setup.md).

## Local development

```bash
# 1. Node API + web
npm install
npm run dev            # web on :3000, api on :4000

# 2. Python agent service (real AI)
cd services/agent
python -m venv .venv && .venv/Scripts/activate     # (or source .venv/bin/activate)
pip install -r requirements-dev.txt                # add -r requirements-rag.txt for RAG
cp .env.example .env                               # set a provider key, e.g. ANTHROPIC_API_KEY
uvicorn app.main:app --reload --port 8000
```

Then set `AGENT_SERVICE_URL=http://127.0.0.1:8000` in the repo-root `.env` so the
API delegates AI to the agent service. With `DATABASE_URL` set (and `pgvector`
enabled), fit scoring becomes retrieval-augmented.

Verify everything:

```bash
npm run check                                   # web + api: lint, typecheck, build
cd services/agent && pytest && ruff check app tests
```

## Status

Phases 0–5 (CRM, AI endpoints, n8n, weekly reporting) and the AI-agent push are
complete:

| Phase | Scope | Status |
| --- | --- | --- |
| 0–5 | CRM, AI endpoints (mock), n8n, weekly reporting, Azure Postgres | ✅ |
| 9 | Real multi-provider LLM + Python agent service | ✅ |
| 10 | RAG + pgvector + HF embeddings | ✅ |
| 8 | Advanced LangChain agents (interview-prep, research, skill-gap) | ✅ |
| 11 | Time-series telemetry intelligence (+ EV demo) | ✅ |
| 6 | Live Azure hosting for web/api/agent + Postgres/pgvector | ✅ |
| 7 | Zapier/Make companion flows | ✅ |

On top of the original plan, a **production-grade AI program** (epic #43) hardens the
system for real operation and is now **fully complete (Phases 1–5)**:

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Real Adzuna ingestion, Langfuse tracing, eval harness (#43) | ✅ |
| 2 | Rate-limiting + cost ceiling, PII redaction, two-tier eval gating, injection + moderation guardrails (#51) | ✅ |
| 3 | LangGraph application-assistant + MCP (server + client) + end-to-end SSE streaming (#61) | ✅ |
| 4 | Hybrid retrieval (pgvector + Postgres FTS via RRF) + CPU cross-encoder reranker + retrieval-mode eval (#70) | ✅ |
| 5 | Hardening: job-search caching, Bicep IaC, k6 load test, Playwright e2e (#76) | ✅ |

CI now runs the repo checks **plus the API test suite, Bicep validation, and a (secret-gated)
web e2e job** alongside the agent/MCP pytest. Phase 4's measured retrieval gains are in
[EVALS.md](EVALS.md); the full breakdown is in [docs/ROADMAP.md](docs/ROADMAP.md).

Phase 6 hosting and data layer are fully live and verified end to end: web, API,
and the Python agent are deployed, and the cloud Postgres carries the complete
schema including the `pgvector` embeddings store (extension + `embeddings` table +
vector index applied 2026-06-10). The optional Phase 6 hardening is also in place:
Application Insights monitoring spans web/API/agent, and the App Service secrets are
served from Key Vault via managed identity.

See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) and
[docs/ROADMAP.md](docs/ROADMAP.md).

## Working this repo

1. Branch from `main` (protected; CI must pass).
2. Keep changes coherent; run `npm run check` (and `pytest`/`ruff` for the agent) before committing.
3. Open a PR; squash-merge after green CI.

## Safety and human approval

JobOps Copilot supports the user, it does not replace judgment.

- It drafts outreach but never sends automatically.
- It suggests resume emphasis but never fabricates experience.
- It scores fit and researches companies, but the user decides.
- Outputs stay structured, grounded, and auditable.

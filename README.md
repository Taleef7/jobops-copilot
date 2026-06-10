# JobOps Copilot

**An AI-agent operations platform for the job search.** JobOps Copilot tracks
opportunities in a CRM, then uses real LLMs, retrieval-augmented generation, and
multi-step agents to analyze fit, research companies, prep interviews, plan
skill gaps, draft outreach, and surface time-series insights — with a human in
the loop at every critical step.

It is intentionally a **responsible AI operations system, not an auto-apply
bot**: it drafts and recommends, but never sends or fabricates.

> **Live on Azure:** dashboard → https://jobops-web.azurewebsites.net ·
> API health → https://jobops-api.azurewebsites.net/api/health
> (Web + API run on Azure App Service against Azure PostgreSQL. The Python
> agent service runs locally for the full-AI demo; the cloud app degrades
> gracefully to the deterministic analysis when the agent is not attached.)

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
  and weekly reports.
- **Production discipline** — npm + Python CI (lint, typecheck, build, tests),
  protected `main`, Azure PostgreSQL, Blob Storage export, and an App Service
  deploy workflow.

## Architecture

```
apps/web (Next.js 16 / React 19)
        │  REST
apps/api (Express, TypeScript) ──delegates AI──> services/agent (Python / FastAPI)
        │                                              │  LangChain (multi-provider)
        └──────── Azure PostgreSQL ◄───────────────────┘  + pgvector (RAG)
                  (jobs CRM + embeddings)                  HF embeddings (PyTorch)
                                                           pandas (telemetry)
```

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
- **Automation:** n8n.

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
| 7 | Zapier/Make companion flows | ⏳ deferred |

Phase 6 hosting and data layer are fully live and verified end to end: web, API,
and the Python agent are deployed, and the cloud Postgres carries the complete
schema including the `pgvector` embeddings store (extension + `embeddings` table +
vector index applied 2026-06-10). App Insights monitoring and Key Vault remain an
optional hardening item (deferred), not a blocker.

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

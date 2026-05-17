# JobOps Copilot

JobOps Copilot is a cloud-ready job search operations CRM that helps you track opportunities, analyze fit, draft outreach, and generate weekly strategy reports with human approval at every critical step.

## Overview

The project is intentionally designed as a responsible AI operations system rather than an auto-apply bot. Phase 0 established the foundation, Phase 1 added functional job tracking, and Phase 2 now adds job parsing and fit scoring:

- a polished Next.js dashboard;
- an Express API scaffold with persistent job CRUD and AI analysis endpoints;
- PostgreSQL schema drafts;
- prompt templates for AI workflows;
- documentation for Azure, n8n, Zapier, and Make.com;
- sample data for jobs, resumes, and reports.

The current implementation uses live API-backed job storage with a local persistent data file by default, and it can switch to PostgreSQL when `DATABASE_URL` is configured. Create, update, parse, and fit-score flows survive API restarts in file mode, while the schema and repository are ready for a real database connection.

## Planned Features

- manual job intake
- job description parsing
- resume-fit scoring
- truthful resume-tailoring suggestions
- recruiter and referral outreach drafting
- application status tracking
- follow-up reminders
- weekly reporting and analytics
- n8n workflow orchestration
- Zapier and Make companion automations
- Azure hosting and storage

## Tech Stack

- Next.js 16 with TypeScript
- React 19
- Express 4
- PostgreSQL-compatible SQL migrations
- Azure Blob Storage, Azure Functions, and Azure Static Web Apps in later phases
- n8n, Zapier, and Make.com for workflow automation

## Architecture

- `apps/web`: dashboard and product UI
- `apps/api`: API scaffold with health, jobs, and AI placeholder endpoints
- `db/migrations`: PostgreSQL schema drafts
- `db/seed`: sample seed data
- `prompts`: structured prompt templates for LLM-backed workflows
- `workflows`: documentation for n8n, Zapier, and Make.com
- `samples`: sample job descriptions, resume content, and weekly reports

## Local Development

1. Install dependencies.

```bash
npm install
```

2. Run the frontend and backend together.

```bash
npm run dev
```

3. Or run each workspace separately.

```bash
npm run dev:web
npm run dev:api
```

4. Verify the repository.

```bash
npm run typecheck
npm run lint
npm run build
```

The frontend runs on the default Next.js port and the API runs on `http://localhost:4000`.
The web app reads `NEXT_PUBLIC_API_BASE_URL` from `.env.local` and defaults to `http://127.0.0.1:4000`, so only change it if you move the API elsewhere. If you want the Postgres-backed store active, add a real `DATABASE_URL` before starting the API.
For Azure PostgreSQL specifically, put the connection string in `apps/api/.env` and run `npm run db:init --workspace @jobops/api` before `npm run dev:api`.

## Project Status

Current phase: Phase 2 AI parsing and fit scoring.

What is real now:

- dashboard pages and navigation
- live jobs list, create, detail, and update flows
- live parse-job and score-fit actions from the job detail page
- persistent job storage for the API
- seed-backed dashboard fallback when the API is unavailable
- API route scaffolds and validation
- job analysis persistence and fit score updates
- database schema drafts
- prompt templates
- workflow documentation
- Azure PostgreSQL bootstrap support via `npm run db:init --workspace @jobops/api`

What is still mocked or placeholder-based:

- LLM provider integration is still mock-mode when no provider key is configured
- outreach generation logic
- weekly report generation logic
- Azure deployment wiring
- real PostgreSQL connectivity is available behind `DATABASE_URL`, but this checkout currently falls back to the local file store

## Roadmap

1. Phase 0: Project foundation
2. Phase 1: CRM MVP with real job CRUD
3. Phase 2: AI parsing and fit scoring
4. Phase 3: Outreach drafting
5. Phase 4: n8n workflow integration
6. Phase 5: Weekly reporting
7. Phase 6: Azure deployment
8. Phase 7: Zapier and Make companion flows
9. Phase 8: Advanced agents

## Safety And Human Approval

JobOps Copilot is designed to support the user, not replace judgment.

- It may draft outreach, but it must not send messages automatically.
- It may recommend resume improvements, but it must not fabricate experience.
- It may score job fit, but the user remains in control of the final decision.
- It may schedule reminders and summarize data, but it should stay auditable and transparent.

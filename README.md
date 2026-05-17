# JobOps Copilot

JobOps Copilot is a cloud-ready job search operations CRM that helps you track opportunities, analyze fit, draft outreach, and generate weekly strategy reports with human approval at every critical step.

## Overview

The project is intentionally designed as a responsible AI operations system rather than an auto-apply bot. Phases 0 through 2 are implemented and verified:

- a polished Next.js dashboard;
- an Express API with persistent job CRUD, AI parsing, fit scoring, and outreach draft endpoints;
- an Azure PostgreSQL-backed CRM path with a repeatable bootstrap script;
- PostgreSQL schema and seed data that can be applied idempotently;
- prompt templates for AI workflows;
- documentation for Azure, n8n, Zapier, and Make.com;
- sample data for jobs, resumes, and weekly reports;
- GitHub Actions CI and branch protection on `main`.

The API supports both local file mode and PostgreSQL mode. In this workspace, the Azure PostgreSQL path is verified through `apps/api/.env`, while the file store remains the fallback when `DATABASE_URL` is absent.

## Current Status

See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) for the full progress snapshot.

- Phase 0 foundation complete
- Phase 1 CRM MVP complete
- Phase 2 AI parsing and fit scoring complete
- Phase 3 outreach drafting, inbox review, and optional Gmail draft creation are browser-verified locally
- Azure PostgreSQL bootstrap and live database verification complete
- CI runs on push and pull request
- `main` is protected and requires the CI checks to pass

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
- `apps/api`: API scaffold with health, jobs, and AI endpoints
- `db/migrations`: PostgreSQL schema
- `db/seed`: sample seed data
- `prompts`: structured prompt templates for LLM-backed workflows
- `workflows`: documentation for n8n, Zapier, and Make.com
- `samples`: sample job descriptions, resume content, and weekly reports

## Local Development

1. Install dependencies.

```bash
npm install
```

2. If you want the Azure PostgreSQL-backed path locally, create `apps/api/.env` with `DATABASE_URL` and run the bootstrap script.

```bash
npm run db:init --workspace @jobops/api
```

3. Run the frontend and backend together.

```bash
npm run dev
```

4. Or run each workspace separately.

```bash
npm run dev:web
npm run dev:api
```

5. Verify the repository.

```bash
npm run typecheck
npm run lint
npm run build
```

The frontend runs on the default Next.js port and the API runs on `http://localhost:4000`.
The web app reads `NEXT_PUBLIC_API_BASE_URL` from `.env.local` and defaults to `http://127.0.0.1:4000`, so only change it if you move the API elsewhere. If you want the Postgres-backed store active, add a real `DATABASE_URL` before starting the API.
If you want optional Gmail draft creation, set `GMAIL_DRAFTS_ENABLED=true` and provide `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` from a Google Cloud OAuth flow with the Gmail compose scope.

## Working This Repo

1. Create a feature branch from `main`.
2. Make the smallest coherent set of changes you can.
3. Run `npm run check` before you commit.
4. Run `git diff --cached --check` before the commit lands.
5. Use a descriptive commit message that explains the scope.
6. Push the branch and open a PR to `main`. `main` is protected and requires CI to pass.

## Project Status

Current phase: Phase 4 in progress. n8n workflow integration is underway.

What is real now:

- dashboard pages and navigation
- live jobs list, create, detail, and update flows
- live parse-job and score-fit actions from the job detail page
- draft-outreach and outreach review/status endpoints
- live outreach inbox with drafted, approved, sent, and skipped states
- optional Gmail draft creation behind a feature flag
- browser-verified end-to-end outreach draft flow with optional Gmail draft creation
- weekly report draft endpoint
- live Azure PostgreSQL storage behind `DATABASE_URL`
- seed-backed dashboard fallback when the API is unavailable
- API route scaffolds and validation
- job analysis persistence and fit score updates
- database schema and idempotent Azure bootstrap support
- prompt templates
- workflow documentation
- n8n webhook endpoints for job intake, follow-up reminders, and weekly report drafts
- GitHub Actions CI on push and pull request
- protected `main` branch with required checks

What is still mocked or placeholder-based:

- LLM provider integration is still mock-mode when no provider key is configured
- weekly report persistence and dashboards
- outreach sending remains manual-only
- full Azure hosting for the web and API apps
- Blob Storage integration

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

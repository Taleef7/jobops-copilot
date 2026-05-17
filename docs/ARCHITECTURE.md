# Architecture

## Current Shape

JobOps Copilot is a monorepo with a clean split between UI, API, data, and workflow docs:

- `apps/web` is the dashboard built with Next.js App Router and TypeScript.
- `apps/api` is the Express API with jobs, health, and AI routes.
- `db/migrations` contains the PostgreSQL schema.
- `db/seed` contains repeatable sample data.
- `prompts` contains the prompt templates used by the AI workflows.
- `workflows` documents the n8n, Zapier, and Make.com plans.
- `samples` contains example job descriptions, resumes, and reports.

## Runtime Model

The repository now supports two data-store modes through the same API contract:

- file mode when `DATABASE_URL` is not set
- PostgreSQL mode when `DATABASE_URL` points at Azure Database for PostgreSQL or another compatible server

The web app prefers live API data, and it falls back to seeded local data only when the API is unavailable. The API routes all CRM reads and writes through a store abstraction so the dashboard does not need to care which backing store is active.

The current backend flow is:

1. A job is created or updated in the dashboard.
2. The web app sends the change to the API.
3. The API stores the job in the active backend.
4. AI parsing converts raw job text into structured fields.
5. Fit scoring compares the job against the resume and profile text.
6. Outreach drafting creates a draft only and stores it for human review.
7. Weekly reporting returns a draft report from the seeded analytics data.

## Core Implementation Pieces

- `apps/api/src/data/job-store.ts` selects file mode or PostgreSQL mode.
- `apps/api/src/data/job-store.postgres.ts` implements the database-backed store.
- `apps/api/src/lib/postgres.ts` creates and manages the `pg` pool.
- `apps/api/src/lib/analysis-core.ts` centralizes parsing, fit scoring, validation, and structured analysis generation.
- `apps/api/scripts/db-init.ts` bootstraps the Azure PostgreSQL schema and seed data.

## Data Flow

### Jobs

Jobs are the CRM source of truth. The list and detail pages read job records, analysis, and outreach drafts through the API. Job updates write back to the same store, and the `fit_score` is duplicated on the job row for efficient sorting and dashboard summaries.

### AI Analysis

`parse-job` and `score-fit` both use the same shared analysis core so that the shapes returned to the UI and the shapes stored in the database stay aligned. That reduces drift between mock responses, validation, and persistence.

### Outreach

`draft-outreach` creates a draft with safety notes and stores it as a draft record when a valid `job_id` is supplied. The job detail page can generate the draft and the outreach inbox can move it through approved, sent, or skipped manually. When the Gmail feature flag is enabled with OAuth credentials, the API can also create a Gmail draft for later manual sending. The workflow is intentionally human-reviewed and does not auto-send anything.

### Weekly Reports

`generate-weekly-report` currently returns a report draft based on seeded analytics data. Persisted report storage and dashboards are still future work.

## Infrastructure

- Azure PostgreSQL is the live cloud database path used by the repository when `DATABASE_URL` is present.
- GitHub Actions runs lint, typecheck, and build on push and pull request.
- `main` is protected, so future changes should land through feature branches and PRs.

## Design Principles

- Human-in-the-loop by default.
- CRM-first data modeling.
- Structured JSON outputs for AI tasks.
- Azure-visible cloud architecture.
- No automatic application submissions or message sending.

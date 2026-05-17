# Architecture

## Current Shape

JobOps Copilot uses a monorepo-style structure:

- `apps/web` is the dashboard built with Next.js App Router and TypeScript.
- `apps/api` is the API scaffold built with Express and TypeScript.
- `db/migrations` holds PostgreSQL-compatible schema drafts.
- `db/seed` holds sample SQL seed data.
- `prompts` holds the prompt templates that future AI workflows will use.
- `workflows` documents n8n, Zapier, and Make.com automation plans.

## Runtime Model

The current phase is intentionally mock-backed.

- The frontend reads from local mock data.
- The API uses in-memory data structures for placeholder responses.
- The database schema exists as a draft and is not yet connected.

That gives us a clean product shape without blocking on persistence or AI integration.

## Target Production Flow

1. The user adds or discovers a job.
2. The frontend sends the record to the backend.
3. The backend stores the job in PostgreSQL.
4. AI parsing converts the raw description into structured fields.
5. Fit scoring compares the job against the resume/profile.
6. Outreach drafting creates human-reviewed message drafts.
7. n8n orchestrates reminders and weekly reporting.
8. Azure hosts the web app, API, storage, and monitoring.

## Design Principles

- Human-in-the-loop by default.
- CRM-first data modeling.
- Structured JSON outputs for AI tasks.
- Azure-visible cloud architecture.
- No automatic application submissions or message sending.

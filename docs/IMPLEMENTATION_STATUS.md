# Implementation Status

## Snapshot

JobOps Copilot now has a working end-to-end foundation through weekly reporting:

- Next.js dashboard for jobs, outreach, reports, and settings
- Express API with persistent job CRUD and AI analysis endpoints
- Azure Database for PostgreSQL Flexible Server backing the live CRM store
- GitHub Actions CI on push and pull request
- branch protection on `main`
- repeatable Azure bootstrap support for local development against the cloud database

It now also has a real AI layer: a Python agent service with multi-provider
LLMs, RAG over pgvector, multi-step LangChain agents, and time-series telemetry
intelligence.

## Verified Milestones

- Multi-tenant: every account is isolated. Data (jobs, reports, outreach, embeddings) is scoped to the Clerk user id; the web forwards the session token to the API via a server-side proxy (`/api/proxy/*`), which `@clerk/express` verifies. New accounts start empty and complete a resume onboarding step (PDF upload or paste); a per-account "Load sample data" / "Clear my data" control lives in Settings. RAG retrieval is user-scoped. The EV/telemetry feature was removed from the app shell (endpoints retained in `services/agent` for demos).
- Frontend redesign: Next.js + Tailwind v4 + shadcn/ui (Base UI) with light/dark themes, fully responsive shell (sidebar + mobile sheet), a marketing landing page, and Clerk authentication with protected routes. All pages ported (dashboard, jobs, job detail tabs with per-agent tabs, outreach kanban, reports, settings, add-job, onboarding). Settings reflects real provider/integration status (no hardcoded values). Verified end-to-end with Playwright (auth flow, dark mode, responsiveness, zero app console errors).
- Phase 9: real multi-provider LLM integration via the Python agent service (parse, score, outreach, weekly) with mock fallback
- Phase 10: RAG with pgvector + Hugging Face embeddings; retrieval-augmented fit scoring
- Phase 8: advanced LangChain agents — interview-prep, company research (web-search tool), skill-gap planner — surfaced in the dashboard
- Phase 11: pandas time-series telemetry (trend/anomaly/forecast) with LLM narration + synthetic EV battery demo
- Phase 0: project foundation complete
- Phase 1: CRM MVP complete
- Phase 2: AI parsing and fit scoring complete
- Phase 3: outreach drafting and human review complete
- Phase 3: outreach draft flow and optional Gmail draft creation browser-verified locally
- Phase 4: n8n local runtime validation complete, including live workflow imports, secret wiring checks, webhook round-trips, and screenshots
- Phase 5: weekly reporting complete, including persisted reports, dashboard history, and markdown export
- Azure PostgreSQL bootstrap complete
- Phase 6: live Azure hosting complete — web (App Service), API (App Service, `postgres` mode), and the Python agent (Container Apps) are deployed and healthy; cloud Postgres carries the full schema including the pgvector embeddings store (verified 2026-06-10)
- repo CI complete
- `main` branch protected

## What Is Live Now

- Jobs can be created, listed, viewed, and updated through the API and dashboard
- `parse-job` and `score-fit` persist structured analysis back onto the job record
- `draft-outreach` creates human-reviewed outreach drafts from the job detail page
- outreach drafts are visible in the inbox and can be approved, marked sent, or skipped manually
- `draft-outreach` can optionally create a Gmail draft when the feature flag and OAuth credentials are configured
- the outreach draft path and Gmail draft side effect were verified in the local browser against the live app
- `generate-weekly-report` persists weekly reports, returns the saved draft, and feeds the reports dashboard
- weekly reporting is persisted and surfaced through the dashboard and reports API
- `POST /api/n8n/job-intake`, `POST /api/n8n/follow-up-reminders`, and `POST /api/n8n/weekly-report` expose the Phase 4 webhook surface
- `GET /api/reports` and `GET /api/reports/latest` provide the saved weekly report history
- The API switches between local file mode and Postgres mode depending on `DATABASE_URL`
- `GET /api/health` reports which store is active

## Live Deployment

- Web (Next.js, standalone) and API (Express) are deployed on **Azure App Service**
  (one B1 Linux plan, Mexico Central) against the live **Azure PostgreSQL**:
  - dashboard: https://jobops-web.azurewebsites.net
  - API health: https://jobops-api.azurewebsites.net/api/health
- `pgvector` is allow-listed on the Postgres server; firewall opened to Azure services.
- The Python agent service is deployed on **Azure Container Apps** (consumption,
  scale-to-zero) in East US, so the live URL is **fully agent-powered** end to end
  (web → API → agent → `gpt-5.4-nano`, with RAG over pgvector). The cloud API still
  degrades gracefully to the deterministic analysis if the agent is ever unattached.
  Image is CPU-only torch (~1.6 GB) built locally and pushed to ACR (Azure for
  Students blocks server-side ACR Tasks builds).
- The cloud Postgres carries the **complete** schema. The `pgvector` migration
  (`003_vector_store.sql`) was applied to the live DB on 2026-06-10 — verified:
  `vector` extension v0.8.2, the `embeddings` table (with `user_id`), and the
  `embeddings_vector_idx` similarity index all exist. RAG retrieval on the cloud
  is fully backed end to end. (The earlier "flaky connection" blocker was in fact
  the server firewall not allow-listing the local client IP; adding a firewall
  rule for the current IP let the idempotent `db:init` run cleanly.)
- **Phase 7 companion automations are live.** A Zapier flow (Google Sheets
  new/updated row → Google Calendar follow-up reminder) is built, tested, and
  published; a Make scenario (Webhook → API `/api/n8n/job-intake` → email) runs
  end to end. Importable blueprint + setup guides are under `workflows/`, with a
  side-by-side comparison in `docs/AUTOMATION_WORKFLOWS.md` and screenshots in
  `docs/design/phase7/`.
- **Optional Phase 6 hardening is done.** Application Insights (`jobops-insights`
  + Log Analytics `jobops-logs`, 1 GB/day cap) instruments web, API, and agent;
  Key Vault (`jobops-kv`, RBAC) holds the App Service secrets (`DATABASE-URL`,
  `CLERK-SECRET-KEY`) as managed-identity references (applied 2026-06-10).

## What Is Still Pending

- Nothing blocking. All planned phases (0–11) plus the optional Phase 6
  hardening (App Insights, Key Vault) are complete. The agent Container App
  keeps its native secret store by design (Key Vault covers App Service only).

## How To Verify The Live Stack

1. `npm run check`
2. `npm run db:init --workspace @jobops/api`
3. `npm run dev:api`
4. `GET /api/health`
5. `GET /api/jobs`
6. `POST /api/ai/score-fit`

## Working Habits

- Use feature branches.
- Keep `main` protected.
- Commit in focused chunks with descriptive messages.
- Run `npm run check` and `git diff --cached --check` before committing.
- Never commit local secrets or temp tool state.

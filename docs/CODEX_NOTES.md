# Codex Notes

## Implementation Decisions

- Next.js App Router was used for the frontend because it gives a clean route structure and fits the dashboard use case well.
- Express was used for the API scaffold because it is lightweight and easy to adapt later into Azure Functions or another serverless host.
- The frontend now prefers live API data and only falls back to seeded jobs when the API is unavailable.
- The API supports both a local file store and a PostgreSQL-backed store selected by `DATABASE_URL`.
- The analysis flow is centralized in `apps/api/src/lib/analysis-core.ts` so parsing, fit scoring, validation, and persistence all agree on the same structured shapes.
- Outreach drafts now originate from the job detail page and flow into a review inbox with manual drafted, approved, sent, and skipped statuses.
- Optional Gmail draft creation is available behind `GMAIL_DRAFTS_ENABLED` and uses Gmail OAuth refresh-token credentials when configured.
- The outreach draft path was browser-verified locally end to end after the Gmail OAuth setup.
- The Azure PostgreSQL bootstrap script in `apps/api/scripts/db-init.ts` keeps the cloud database setup repeatable.
- The schema avoids `pgcrypto`, so Azure compatibility does not depend on allow-listed database extensions.
- The local n8n runtime pass is verified with live imports for `jobIntakePhase4`, `followUpPhase4`, and `weeklyReportP4`.
- n8n v2 runtime in this setup needs `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` so workflow expressions can read `$env.*` values.
- Product overhaul (epic #124): dashboards/cards read live aggregates, the Parse step was folded into Score-fit, and outreach was reduced to a single canonical draft (#118).
- The `/jobs` feed pre-ranks jobs on ingest and computes the LLM fit score lazily on open, with a recency filter and a scheduled discovery cron (#119).
- Add-job autofill goes through `POST /api/jobs/extract`, a tiered extractor behind an SSRF guard and the strict rate limiter (#120).
- Agent outputs persist via migration `008_agent_outputs.sql` and `GET /api/jobs/:id/agent-outputs`, with a Regenerate action plus generated-at/model metadata (#121).
- The global floating assistant streams from `POST /api/ai/assistant/chat` (multi-turn, context-aware, `sessionStorage`-persisted); when the agent is disabled the structured stream returns 503, not 500 (#122, PR #140).
- Identity is consolidated on Clerk: migration `009_drop_display_name.sql` drops `user_profiles.display_name`, name/avatar/email come from `currentUser()`, and `profile_text` grounding is kept (#123).

## Verified Infrastructure

- Azure Database for PostgreSQL Flexible Server is live and used as the active Postgres path when `DATABASE_URL` is set.
- GitHub Actions CI runs lint, typecheck, and build on push and pull request.
- `main` is protected, so future work should land through feature branches and PRs.
- The repo can be validated locally with `npm run check`.

## Working Habits

- Use feature branches instead of committing directly to `main`.
- Keep commits focused and descriptive.
- Run `npm run check` before committing.
- Run `git diff --cached --check` before committing.
- Do not commit secrets, temp tool state, or generated artifacts that belong in `.gitignore`.
- If Azure PostgreSQL is involved, run `npm run db:init --workspace @jobops/api` after setting `apps/api/.env`.

## Assumptions

- Azure Blob Storage will eventually hold uploaded resumes and generated reports.
- AI outputs should stay structured and auditable.
- Outreach and application actions should remain human-approved.
- `NEXT_PUBLIC_API_BASE_URL` defaults to `http://127.0.0.1:4000` for local development.

## Next Recommended Task

All phases are complete (0–11) plus the optional Phase 6 hardening. Phase 6 is live:
web + API on Azure App Service, the agent on Container Apps, Blob Storage wired,
Application Insights (`jobops-insights`) across all three services, and Key Vault
(`jobops-kv`) serving the App Service secrets via managed identity. Phase 7 (Zapier +
Make companion flows) is built and live with screenshots.

The **product overhaul** (epic #124) is also complete — all six phases (#118–#123) plus
cleanup PR #140 merged to `main` on 2026-06-25.

No outstanding implementation task. The only remaining items are two owner-gated deploy
follow-ups that need production credentials:

- **#141** — activate the agent Container App revision that includes `/assistant/chat`, and
  apply migration `009_drop_display_name.sql` to the production DB.
- **#142** — add cold-start resilience for the streaming endpoints on the scale-to-zero agent.

Otherwise the focus is maintenance and demos.

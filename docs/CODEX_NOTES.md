# Codex Notes

## Implementation Decisions

- Next.js App Router was used for the frontend because it gives a clean route structure and fits the dashboard use case well.
- Express was used for the API scaffold because it is lightweight and easy to adapt later into Azure Functions or another serverless host.
- The frontend now prefers live API data and only falls back to seeded jobs when the API is unavailable.
- The API supports both a local file store and a PostgreSQL-backed store selected by `DATABASE_URL`.
- The analysis flow is centralized in `apps/api/src/lib/analysis-core.ts` so parsing, fit scoring, validation, and persistence all agree on the same structured shapes.
- The Azure PostgreSQL bootstrap script in `apps/api/scripts/db-init.ts` keeps the cloud database setup repeatable.
- The schema avoids `pgcrypto`, so Azure compatibility does not depend on allow-listed database extensions.

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

- The next real backend phase will focus on outreach drafting.
- Azure Blob Storage will eventually hold uploaded resumes and generated reports.
- AI outputs should stay structured and auditable.
- Outreach and application actions should remain human-approved.
- `NEXT_PUBLIC_API_BASE_URL` defaults to `http://127.0.0.1:4000` for local development.

## Next Recommended Task

Implement Phase 3:

- wire outreach drafting into the UI;
- persist outreach drafts in the `outreach` table;
- keep the human-in-the-loop approval workflow intact;
- optionally add Gmail draft generation after the review flow is stable.

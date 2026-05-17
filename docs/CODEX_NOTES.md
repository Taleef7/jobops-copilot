# Codex Notes

## Implementation Decisions

- Next.js App Router was used for the frontend because it gives a clean route structure and fits the dashboard use case well.
- Express was used for the API scaffold because it is lightweight and easy to adapt later into Azure Functions.
- The frontend falls back to seeded jobs when the API is unavailable, but it now prefers live API data for the CRM screens.
- The API now supports a persistent local job store and a PostgreSQL-backed store selected by `DATABASE_URL`.
- The analysis flow is centralized in `apps/api/src/lib/analysis-core.ts` so parsing, fit scoring, validation, and persistence all agree on the same structured shapes.
- The PostgreSQL schema drafts remain the forward path for a later fully managed database deployment, but the repository is already ready for it.

## Assumptions

- The first real backend phase will use PostgreSQL.
- Azure Blob Storage will eventually hold uploaded resumes and generated reports.
- AI outputs should stay structured and auditable.
- Outreach and application actions should remain human-approved.
- `NEXT_PUBLIC_API_BASE_URL` defaults to `http://127.0.0.1:4000` for local development.
- If you want to exercise the live PostgreSQL path, you still need to provide a real `DATABASE_URL`.

## Next Recommended Task

Implement Phase 3:

- implement outreach drafting and the outreach review page;
- persist outreach drafts in the `outreach` table;
- keep the human-in-the-loop approval workflow intact.

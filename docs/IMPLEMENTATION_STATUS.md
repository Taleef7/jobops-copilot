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

## Security & audit remediation

A 2026-07 full-stack security + engineering audit (overall grade **B**) was remediated in
four phases, **all merged (2026-07-25)**: fail-closed auth (API + agent), the Next.js
middleware-CVE patch, and crash/resilience guards (P1); cross-tenant RAG scoping, full-suite
CI gating, real-DB tenancy tests, and SHA-pinned Actions + `npm`/`pip` audit gates (P2); the
eval-integrity correction that withdrew the inflated faithfulness claim and produced the
project's first demonstrated hybrid-retrieval win (P3); and the polish/scale work — assistant
a11y + route boundaries, a `what-if`-verified faithful Bicep reconcile, a pinned + lock-audited
agent image, list pagination, and an opt-in Postgres-backed rate-limiter/cache for scale-out
(P4). The running journal, per-finding PR log, and behavioral notes live in
[AUDIT_REMEDIATION.md](AUDIT_REMEDIATION.md) (epic #152).

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

### Production-grade AI program (epic #43, beyond the original 0–11 plan)

- **Phase 1 — real data + LLMOps:** real Adzuna ingestion + saved searches + dedup (#44);
  Langfuse tracing of every agent LLM/RAG call, no-op without keys (#45); eval harness —
  deterministic parse-job + Ragas score-fit on a real gold set (#46).
- **Phase 2 — safety, guardrails & eval gating:** API rate-limiting + per-user daily AI
  cost ceiling + `helmet` (#53); contact-PII redaction before LLMs + Langfuse trace mask
  (#54); two-tier eval gate (key-free PR checks + main thresholds/regression) + full
  `EVALS.md` (#55); prompt-injection defense + provider-agnostic output moderation +
  groundedness (#56).
- **Phase 3 — LangGraph + MCP + streaming (epic #61):** stateful application-assistant graph
  (#63); end-to-end SSE streaming to the dashboard (#64); JobOps MCP server (FastMCP REST
  bridge, #65); agent-as-MCP-client consuming external tools (#66).
- **Phase 4 — hybrid retrieval, reranker & eval (epic #70):** hybrid retrieval (pgvector +
  Postgres FTS via RRF, #67); CPU cross-encoder reranker (opt-in, graceful, #68); retrieval-mode
  eval with the per-mode comparison committed to `EVALS.md` (#69). Fine-tuning dropped
  (CPU-only infra). **Numbers withdrawn and re-measured twice — see `EVALS.md` for the audit
  trail.** The original "≈3× faithfulness" was a judge-visibility artifact (#197: the sweep fed
  the resume to the generator in every arm). The first re-measurement was still invalid (#198:
  the gold resume chunked into 4 pieces at `k=4`, so retrieval selected nothing) and the
  lexical side of "hybrid" matched 0/16 JDs, making hybrid byte-identical to vector.
  **Current measurement** (9-chunk resume, `k=4`, parsed title+skills as the query, lexical
  firing 16/16): **hybrid beats dense-only** — 5 replicates each, `hybrid` 0.821
  (0.800–0.848) vs `vector` 0.716 (0.706–0.733) Spearman, non-overlapping ranges. The first
  retrieval improvement the project has been able to demonstrate, and only measurable once the
  lexical side was revived. Retrieval also *outranks the whole resume* (`full-resume` 0.612):
  extra context dilutes the fit signal. Both gains are ranking-specific — faithfulness leans
  the other way and is unresolved. Resume-blind collapses to 0.233.
- **Phase 5 — operational hardening (epic #76):** job-search TTL cache + the API `node:test`
  suite wired into CI (#77); Bicep IaC of the live Azure topology, CI-validated + `what-if`-verified
  (#78); k6 load test verified against the live API (#79); Playwright e2e verified locally and
  against the deployed web (#80). End-to-end verified 2026-06-18 (live API `db:ok`, k6 thresholds
  pass, e2e 5/5).
- Numbered independently of the original phases; design/plans in `docs/superpowers/`.

### Product overhaul (epic #124, complete — merged to `main` 2026-06-25)

- **Phase 1 — truthful data & quick fixes (#118):** dashboard/cards driven by live aggregates,
  real empty states, Parse folded into Score-fit, single canonical outreach draft.
- **Phase 2 — JobRight-style Jobs feed (#119):** in-app discovery on `/jobs` (pre-rank on ingest
  + LLM fit score on open), recency filter, scheduled discovery cron.
- **Phase 3 — add-job URL autofill (#120):** `POST /api/jobs/extract`, an SSRF-guarded tiered
  extractor that autofills the add-job form from a posting URL.
- **Phase 4 — persistent agent outputs (#121):** migration `008_agent_outputs.sql` +
  `GET /api/jobs/:id/agent-outputs`; Regenerate action with generated-at/model metadata.
- **Phase 5 — global floating assistant (#122):** `POST /api/ai/assistant/chat` (streamed),
  multi-turn, context-aware, `sessionStorage`-persisted, accessible.
- **Phase 6 — profile on Clerk (#123):** migration `009_drop_display_name.sql`; identity via
  `currentUser()`, `profile_text` grounding kept.
- Plus cleanup PR #140 (the structured assistant stream returns 503, not 500, when the agent is
  disabled). The two owner-gated deploy follow-ups are **done and closed**: #141 (activate the
  agent revision serving `/assistant/chat` + apply migration 009 in prod) and #142 (assistant
  cold-start resilience for the scale-to-zero agent).

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

- **Jobright Parity Program (Epic #244 — Agent platform foundation):** Epic 1 is complete (#251–#257). Epic 2 (Discovery & Feed Curation) is underway: shipped enriched jobs schema and normalization (#258) with salary range parsing, seniority inference, content hashing, and liveness tracking (migration 013), target_companies watchlist table, CRUD, and settings UI (#260, migration 014), Greenhouse/Lever/Ashby board adapters wired into discovery (#261), USAJobs + The Muse source adapters with Remotive fallback window fix and multi-source discovery (#259), and USCIS H-1B Employer Data Hub import with `h1b_sponsors` reference table and `sponsor_likelihood` matching (#262, migration 015). Specialist agent graph implementations (remaining Epics 2, 4, 5, 6) remain pending.
- Nothing blocking. All planned phases (0–11) plus the optional Phase 6
  hardening (App Insights, Key Vault) are complete. The agent Container App
  keeps its native secret store by design (Key Vault covers App Service only).
- The **production-grade AI program** (epic #43) is **fully complete** — Phases 1–5
  (LLMOps backbone, safety/guardrails, LangGraph+MCP+streaming, hybrid retrieval+reranker+eval,
  operational hardening; epics #43/#51/#61/#70/#76) all landed and were verified end to end.
- The **product overhaul** (epic #124) is **complete** — all six phases (#118–#123) plus cleanup
  PR #140 merged to `main` on 2026-06-25.
- **Product-overhaul deploy follow-ups are done** — **#141** (activated the agent Container App
  revision serving `/assistant/chat` and applied migration `009` to the prod DB) and **#142**
  (cold-start resilience for the streaming endpoints on the scale-to-zero agent) are both closed.
- **Audit remediation (epic #152) is complete** — all four phases merged (2026-07-25):
  fail-closed auth + crash/resilience (P1), tenancy/gating + supply-chain (P2), eval-integrity
  + hybrid-retrieval win (P3), and the polish/scale work (P4: assistant a11y + boundaries,
  faithful Bicep reconcile, pinned + lock-audited agent image, list pagination, and the
  opt-in Postgres-backed rate-limiter/cache for scale-out). See
  [AUDIT_REMEDIATION.md](AUDIT_REMEDIATION.md).
- **Live QA + design sweep (2026-07-25 → 27) is complete** — PRs **#215–#229**, all merged and
  deployed. Truthful fit scores (an evidence floor; the estimator was emitting only 0 or 100),
  a11y and design-system fixes, a recoverable onboarding flow, and the round of UX work that
  followed: the jobs table stacks into cards below `lg` (it was 1783px wide at 375px), the
  duplicate "Search jobs" box is gone from `/jobs`, the auth pages are branded and titled, the
  assistant can run on a job already in the pipeline, and a scored job stops telling you to score
  it. See `docs/AUDIT_REMEDIATION.md` for the earlier audit this follows.
- **The production migration runner was wedged, and migrations are now self-applying** — the sweep
  uncovered that prod's `schema_migrations` recorded nothing from `003` onward, and every `db:init`
  died re-attempting `002_weekly_report_storage`, whose global `(week_start, week_end)` unique index
  cannot be created once `004` has replaced it with a per-user one. **No new migration could reach
  production at all**; it surfaced only because `011` would not apply. (The tables themselves largely
  predate migration tracking — `embeddings` holds rows from 2026-06-03 — so this was a broken
  pipeline rather than a missing schema, but anything new was unshippable and nothing monitored it.)
  **#222** unblocked the runner, **#224** made the API apply migrations at boot from its own deploy
  package and made `/api/health/ready` report `migrations`, which the deploy now gates on. See
  [AZURE_DEPLOYMENT.md](AZURE_DEPLOYMENT.md#database-migrations).
- **Owner-gated optional follow-ups** (by design, not gaps; see `docs/ROADMAP.md`): applying the
  Bicep to a live/greenfield RG, running k6 in CI, and activating the gated e2e CI job (needs
  Clerk repo secrets). Fine-tuning and a larger retrieval gold set remain deferred.
- **Known open items:** the landing hero has no product visual (a design decision, not a defect);
  the TypeScript 7 bump (**#195**) is deferred — TS7 drops `baseUrl` and disallows non-relative
  `paths`, so the project-wide `@/` alias needs migrating first; and `jobs` still holds 11 rows
  under five user ids that no longer exist in Clerk (invisible in the UI, but they would skew any
  global aggregate).

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

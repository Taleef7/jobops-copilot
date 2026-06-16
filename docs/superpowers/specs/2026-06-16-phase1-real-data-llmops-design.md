# Design — Phase 1: Real data + LLMOps backbone

**Date:** 2026-06-16
**Status:** Approved (design accepted; tool stack chosen: Adzuna + no-key fallback, Langfuse, Ragas+pytest)
**Part of:** the "Production-grade AI" program (Phases 1–5) that closes the gaps from the 2026-recruiter critique. This spec covers **Phase 1 only**.

## 1. Why

The app proves it can *call* LLMs and ship a deployed web product. It does not yet
prove it can *operate* LLMs on real data with measurement and tracing — which is
exactly where the 2026 AI-engineering market pays a premium (≈70% of AI-engineer
postings center on "RAG, evals, agents & production deployment"; observability &
evaluation are described as "core infrastructure, not an optional add-on").

Phase 1 turns *"I built an AI app"* into *"I operate AI on real data with tracing
and evals."* Three synergistic pieces: **real data flows in → every AI call is
traced → quality is measured.**

## 2. Goals / non-goals

**Goals**
- **F** — Ingest **real** job postings from an external source on real user queries, with dedup, surfaced into the existing CRM.
- **B** — **Trace every agent AI call** (LLM + RAG) with tokens/cost/latency and a trace tree (Langfuse).
- **A (starter)** — An **eval harness** that scores `parse-job` and `score-fit` on a small real gold set, runnable locally and in a **report-only** CI job.

**Non-goals (deferred to later phases)**
- Guardrails / rate-limiting / PII (Phase 2).
- CI eval **gating** that blocks merges + full `EVALS.md` (Phase 2).
- LangGraph / MCP / streaming (Phase 3).
- Hybrid retrieval / reranker / fine-tuning (Phase 4).
- IaC / full Dockerization / e2e / caching / load test (Phase 5).

## 3. Success criteria (acceptance)
1. A user can define **saved searches**; "Discover now" and a scheduled sweep both ingest real Adzuna postings (or the no-key fallback) into that user's CRM as `status='discovered'`, **deduped**.
2. The Python agent emits **Langfuse traces** for parse/score/outreach/agent runs, including a **manual span around RAG retrieval**, with token/cost/latency captured.
3. `pytest evals/` and `python -m evals.run` produce **parse-job** (deterministic P/R/F1, title/company/seniority accuracy) and **fit-score** (Ragas faithfulness / answer-relevance / context-recall + fit↔label rank correlation) metrics and a markdown/JSON report.
4. A **report-only** CI job (`evals.yml`) runs the small gold set on relevant PRs and uploads the report (does **not** block).
5. **Graceful degradation preserved:** no Adzuna key → fallback source; no Langfuse keys → tracing no-ops; no provider key → eval job skips (xfail) — the app and `npm run check` / agent `pytest`+`ruff` stay green.

## 4. Workstream F — Real ingestion

**Model (decision):** per-user **saved searches** drive discovery — reuses the
user-scoped `jobs` table and the `status='discovered'` flow, and revives the
plan's "Daily Job Discovery." (Rejected alternative: a shared global discovery
pool — more new surface area, weaker fit with the existing per-user model.)

- **Data model:** `db/migrations/004_saved_searches.sql` →
  `saved_searches(id uuid pk, user_id text, query text, location text null, remote_only bool default false, created_at timestamptz, updated_at timestamptz)`, indexed on `user_id`.
- **Sources:** `apps/api/src/lib/job-sources/`
  - `adzuna.ts` — primary; free dev API (`app_id`+`app_key`), returns title/company/location/salary/category/redirect URL. Respect free-tier rate limits; include required attribution.
  - `remotive.ts` — no-key fallback (remote jobs JSON). Used when Adzuna keys are absent or a call fails.
  - `normalize.ts` — map any source to the internal `Job` shape (`source`, `job_url`, `company`, `title`, `location`, `employment_type`, `workplace_type`, `description_text`, `date_posted`).
  - selection: `getJobSource()` returns Adzuna when keyed, else Remotive.
- **Dedup:** insert with `ON CONFLICT (user_id, job_url) DO NOTHING`; for URL-less posts, dedup on a `sha1(company|title|location)` key. (Schema already treats `job_url` as unique-when-present; add the per-user partial unique index.)
- **API surface:** `apps/api/src/routes/discovery.ts`
  - `POST /api/discovery/run` — Clerk-auth'd; runs the current user's saved searches, returns `{inserted, skipped, source}`.
  - `POST /api/discovery/run-all` — service-secret (reuses `N8N_WEBHOOK_SECRET` convention); iterates all users with saved searches; for the scheduled sweep.
  - `GET/POST/DELETE /api/saved-searches` — manage saved searches (Clerk-auth'd), via `data/saved-search-store(.postgres).ts` (file + postgres modes, mirroring existing stores).
- **Triggers/UI:** Settings page manages saved searches; a **"Discover now"** button (Jobs/dashboard) calls `/api/discovery/run`; an **n8n scheduled workflow** calls `/api/discovery/run-all` (export added under `workflows/n8n/`). Discovered jobs render a `source` badge.

## 5. Workstream B — Langfuse tracing

- **Where:** the **Python agent** (`services/agent`), which owns the real AI.
- `app/obs/langfuse.py` — initialize the Langfuse client + LangChain **callback handler** from env (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`). If unset → return a **no-op** handler so nothing breaks.
- Attach the handler to all chain/agent invocations (parse, score, outreach, interview-prep, research, skill-gap). Add a **manual span** around RAG retrieval (HF embed + pgvector query) capturing query, latency, and retrieved-chunk count/scores.
- The TS API forwards a `session_id` (job id / request id) so a user action maps to one trace.
- **Hosting:** `docker-compose.yml` runs Langfuse locally for dev; **Langfuse Cloud (free tier)** backs the live demo. Capture screenshots for docs.
- **Surfacing:** optionally show a couple of aggregate cost/latency stats in the existing telemetry view; full trace trees live in Langfuse.
- **Exact SDK APIs** (current Langfuse v3 + Ragas) will be verified via Context7 during the implementation-plan step.

## 6. Workstream A — Eval harness (Ragas + pytest)

- **Location:** `services/agent/evals/` — `data/parse_job.jsonl`, `data/fit_score.jsonl` (~15–20 hand-labeled examples drawn from **real ingested JDs** + the sample resume), `metrics/`, `run.py`.
- **parse-job (deterministic, no LLM judge — runs every PR):** field-level precision/recall/F1 on extracted skills; exact-match accuracy on title/company/seniority. Cheap and fast.
- **fit-score (Ragas — LLM judge):** faithfulness, answer-relevance, context-recall (is the fit summary grounded in retrieved resume evidence?), plus **rank correlation** between predicted `fit_score` and the human label.
- **Runner:** `pytest evals/` (assertion thresholds, `xfail`/skip when no provider key) and `python -m evals.run` → JSON + markdown report; seeds `EVALS.md` (full metrics table is a Phase-2 deliverable).
- **CI:** `.github/workflows/evals.yml` — **report-only**; triggers on PRs touching `services/agent/**`, `prompts/**`, or eval data; uses a provider-key secret + a **cheap judge model**; runs the small set; uploads the report as an artifact / PR summary. Does **not** block (gating is Phase 2).

## 7. Cross-cutting

- **Config/secrets:** add to `.env.example` (no real values): `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`, eval `JUDGE_MODEL`. Live secrets via App Service config / Key Vault (consistent with existing pattern); CI eval key as a GitHub secret.
- **Testing:** API unit tests for `normalize`/dedup/source-selection and the discovery + saved-search routes (file mode); agent tests for the Langfuse **no-op** path and each eval metric function; preserve existing mock/graceful-degradation tests.
- **Docs:** `EVALS.md` seed; README/ARCHITECTURE updates (ingestion + observability + evals); n8n discovery workflow doc.

## 8. Risks & mitigations
- **Adzuna ToS / rate limits** → free-tier limits, attribution, light caching, fallback source. (No scraping — consistent with the project's stated constraints.)
- **CI eval cost** → tiny gold set + cheap judge + report-only.
- **Cross-user dedup leakage** → dedup scoped per `user_id`.
- **Langfuse self-host friction** → Langfuse Cloud free for the live demo; compose is optional for local.
- **Scope creep** → guardrails/gating/LangGraph/hybrid-RAG explicitly deferred (§2).

## 9. SDLC / delivery
This spec → an implementation plan (`writing-plans`) → **detailed GitHub issues**:
an **epic** ("Phase 1: Real data + LLMOps backbone") plus three **sub-issues**
(F ingestion, B tracing, A evals), each with acceptance criteria and task
checklists, under a **`Phase 1` milestone** with labels. Each sub-issue is
delivered on its own branch → PR (referencing the issue, `Closes #…`) → green CI
→ user merges. TDD where it fits; `npm run check` + agent `pytest`/`ruff` before
every PR.

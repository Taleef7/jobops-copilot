# Phase 1: Real data + LLMOps backbone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Confirm exact third-party APIs (Adzuna response shape, Langfuse v3 SDK, Ragas metrics) via Context7 at the start of the relevant workstream.

**Goal:** Ingest real job postings on real user queries, trace every agent AI call (tokens/cost/latency), and measure parse-job + score-fit quality with an eval harness — without breaking the app's graceful-degradation guarantees.

**Architecture:** Three independent subsystems, each its own GitHub sub-issue and its own branch/PR. **F** (Node/Express): per-user saved searches drive discovery from Adzuna (no-key fallback) into the existing user-scoped `jobs` store with dedup. **B** (Python/agent): a Langfuse callback handler threads through chain `.invoke()` calls, with a manual span around RAG retrieval; no-ops when unconfigured. **A** (Python/agent): a `evals/` package scores a small real gold set with deterministic metrics (parse-job) + Ragas (score-fit), run by pytest + a report-only CI job.

**Tech Stack:** TypeScript/Express, `pg`, Clerk; Python 3.12/FastAPI, LangChain, Langfuse v3, Ragas, pytest; PostgreSQL/pgvector; GitHub Actions.

**Conventions to follow (existing patterns):**
- Dual-mode stores switch on `DATABASE_URL` — mirror `apps/api/src/data/report-store.ts` (file) + `report-store.postgres.ts` (pg via `getPool()` from `@/lib/postgres`).
- Per-user routes: `const userId = requireUser(request, response); if (!userId) return;` (`@/lib/auth`). Service routes: `router.use(requireN8nWebhookSecret)` (`@/lib/n8n`).
- Job creation: `createJob(userId, CreateJobInput)`; listing: `listJobs(userId)` (`@/data/job-store`). `JobRecord`/`CreateJobBody` in `apps/api/src/types.ts`.
- Agent settings: add fields to `app/config.py` `Settings` (pydantic-settings; field `langfuse_public_key` ← `LANGFUSE_PUBLIC_KEY`). Chains call `model.with_structured_output(...).invoke(messages)`.
- Graceful degradation is sacred: missing keys must **no-op**, never raise.

---

## File structure

**Workstream F — ingestion (Node API + web)**
- Create `db/migrations/005_saved_searches.sql` — `saved_searches` table (note: `004_multitenant.sql` already exists).
- Create `apps/api/src/lib/job-sources/adzuna.ts` — Adzuna client → raw results.
- Create `apps/api/src/lib/job-sources/remotive.ts` — no-key fallback client.
- Create `apps/api/src/lib/job-sources/normalize.ts` — source result → `CreateJobBody`-shaped record + `dedupKey()`.
- Create `apps/api/src/lib/job-sources/index.ts` — `getJobSource()` selection + `JobSource` interface.
- Create `apps/api/src/data/saved-search-store.ts` + `saved-search-store.postgres.ts` — dual-mode CRUD.
- Create `apps/api/src/lib/discovery.ts` — `runDiscoveryForUser(userId, deps)` (sources → normalize → dedup vs existing jobs → createJob).
- Create `apps/api/src/routes/discovery.ts` — `POST /api/discovery/run` (user), `POST /api/discovery/run-all` (service secret), `GET/POST/DELETE /api/saved-searches`.
- Modify `apps/api/src/app.ts` — mount the discovery router.
- Modify `apps/web` — Settings: saved-search manager; Jobs/dashboard: "Discover now" button; job row: `source` badge. (Follow existing `/api/proxy` + component patterns.)
- Modify `.env.example` — `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`.
- Create `workflows/n8n/job-discovery.json` + doc — scheduled sweep calling `/api/discovery/run-all`.

**Workstream B — tracing (Python agent)**
- Create `services/agent/app/obs/__init__.py`, `services/agent/app/obs/langfuse.py` — handler factory + `traced_config()`.
- Modify `app/config.py` — Langfuse settings.
- Modify chains (`parse_job.py`, `score_fit.py`, `draft_outreach.py`, `weekly.py`) + `agents/runner.py` — accept optional `config` and forward to `.invoke(...)`.
- Modify `app/rag/store.py` — manual Langfuse span around `retrieve(...)`.
- Modify `app/main.py` — build `traced_config(name, session_id)` per endpoint from request, pass into `_run`.
- Modify `app/schemas.py` — add optional `session_id` to request models.
- Modify `.env.example` — Langfuse vars.
- Create `docker-compose.yml` (repo root) — local Langfuse (web + db) for dev.

**Workstream A — evals (Python agent)**
- Create `services/agent/evals/__init__.py`, `data/parse_job.jsonl`, `data/fit_score.jsonl`.
- Create `services/agent/evals/metrics/extraction.py` — deterministic parse-job metrics.
- Create `services/agent/evals/metrics/ragas_fit.py` — Ragas-based fit-score metrics.
- Create `services/agent/evals/run.py` — load gold sets → run → JSON + markdown report.
- Create `services/agent/tests/test_evals.py` — unit-test the metric functions (no LLM).
- Create `.github/workflows/evals.yml` — report-only CI.
- Create `EVALS.md` (repo root) — seed (Phase 2 fills the full table).
- Modify `services/agent/requirements-dev.txt` / `requirements-rag.txt` — add `langfuse`, `ragas`.

---

## Workstream F — Real ingestion

### Task F1: `saved_searches` migration
**Files:** Create `db/migrations/005_saved_searches.sql`

- [ ] **Step 1: Write the migration** (mirror the `user_id text` + `gen_random_uuid()` style of `004_multitenant.sql`)
```sql
create table if not exists saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  query text not null,
  location text,
  remote_only boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saved_searches_user_idx on saved_searches (user_id);
-- Per-user dedup of discovered jobs by URL (jobs table already has user_id + job_url):
create unique index if not exists jobs_user_url_uniq
  on jobs (user_id, job_url) where job_url is not null;
```
- [ ] **Step 2: Apply locally** — `npm run db:init --workspace @jobops/api` against a dev `DATABASE_URL`. Expected: no error; `\d saved_searches` shows the table.
- [ ] **Step 3: Commit** — `git add db/migrations/005_saved_searches.sql && git commit -m "feat(db): saved_searches table + per-user job URL dedup index"`

### Task F2: Normalize + dedup helper (pure, TDD)
**Files:** Create `apps/api/src/lib/job-sources/normalize.ts`; Test `apps/api/src/lib/job-sources/normalize.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, expect, it } from 'vitest'; // or the repo's test runner (node:test) — match existing *.test.ts
import { normalizeAdzuna, dedupKey } from './normalize';

it('maps an Adzuna result to a CreateJob record', () => {
  const r = normalizeAdzuna({
    redirect_url: 'https://adzuna/x', title: 'AI Engineer',
    company: { display_name: 'Acme' }, location: { display_name: 'Remote' },
    description: 'Build agents', created: '2026-06-01T00:00:00Z', contract_time: 'full_time',
  } as any);
  expect(r).toMatchObject({ jobUrl: 'https://adzuna/x', company: 'Acme', title: 'AI Engineer', source: 'adzuna' });
});

it('dedupKey falls back to company|title|location when no url', () => {
  expect(dedupKey({ jobUrl: undefined, company: 'Acme', title: 'AI Eng', location: 'NYC' } as any))
    .toBe('acme|ai eng|nyc');
});
```
- [ ] **Step 2: Run — expect FAIL** (`npm test --workspace @jobops/api` — confirm the runner first; match the existing `*.test.ts` style, currently node:test/tsx).
- [ ] **Step 3: Implement**
```ts
import type { CreateJobBody } from '@/types';

export type SourcedJob = CreateJobBody & { source: string };

export function normalizeAdzuna(r: any): SourcedJob {
  return {
    jobUrl: r.redirect_url,
    source: 'adzuna',
    company: r.company?.display_name?.trim() || 'Unknown',
    title: r.title?.trim() || 'Untitled role',
    location: r.location?.display_name?.trim() || '',
    employmentType: r.contract_time === 'part_time' ? 'Part-time' : 'Full-time',
    datePosted: r.created,
    descriptionText: (r.description ?? '').toString(),
  };
}

export function normalizeRemotive(r: any): SourcedJob {
  return {
    jobUrl: r.url,
    source: 'remotive',
    company: r.company_name?.trim() || 'Unknown',
    title: r.title?.trim() || 'Untitled role',
    location: r.candidate_required_location?.trim() || 'Remote',
    employmentType: r.job_type ? String(r.job_type).replace('_', '-') : 'Full-time',
    workplaceType: 'remote',
    datePosted: r.publication_date,
    descriptionText: (r.description ?? '').toString(),
  };
}

export function dedupKey(job: SourcedJob): string {
  if (job.jobUrl) return job.jobUrl.toLowerCase();
  return [job.company, job.title, job.location].map((s) => (s ?? '').trim().toLowerCase()).join('|');
}
```
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(api): normalize + dedup for external job sources`

### Task F3: Adzuna + Remotive clients + source selection
**Files:** Create `adzuna.ts`, `remotive.ts`, `index.ts` (+ tests with mocked `fetch`)

- [ ] **Step 1: Failing test** for `getJobSource()` — returns Adzuna when `ADZUNA_APP_ID`/`KEY` set, else Remotive; and `search()` maps results via normalize. Mock global `fetch`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** (confirm Adzuna URL/params via Context7/docs first):
```ts
// index.ts
import type { SourcedJob } from './normalize';
export interface JobSource { name: string; search(query: string, opts: { location?: string; remoteOnly?: boolean; limit?: number }): Promise<SourcedJob[]>; }
import { createAdzunaSource } from './adzuna';
import { createRemotiveSource } from './remotive';
export function getJobSource(): JobSource {
  if (process.env.ADZUNA_APP_ID?.trim() && process.env.ADZUNA_APP_KEY?.trim()) return createAdzunaSource();
  return createRemotiveSource();
}
```
```ts
// adzuna.ts — GET https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=&app_key=&what=&where=&results_per_page=
import { normalizeAdzuna, type SourcedJob } from './normalize';
import type { JobSource } from './index';
export function createAdzunaSource(): JobSource {
  return { name: 'adzuna', async search(query, opts) {
    const u = new URL('https://api.adzuna.com/v1/api/jobs/gb/search/1');
    u.searchParams.set('app_id', process.env.ADZUNA_APP_ID!);
    u.searchParams.set('app_key', process.env.ADZUNA_APP_KEY!);
    u.searchParams.set('what', query);
    if (opts.location) u.searchParams.set('where', opts.location);
    u.searchParams.set('results_per_page', String(opts.limit ?? 20));
    const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Adzuna ${res.status}`);
    const data = (await res.json()) as { results?: unknown[] };
    return (data.results ?? []).map((r) => normalizeAdzuna(r));
  } };
}
```
```ts
// remotive.ts — GET https://remotive.com/api/remote-jobs?search=&limit=
import { normalizeRemotive, type SourcedJob } from './normalize';
import type { JobSource } from './index';
export function createRemotiveSource(): JobSource {
  return { name: 'remotive', async search(query, opts) {
    const u = new URL('https://remotive.com/api/remote-jobs');
    if (query) u.searchParams.set('search', query);
    u.searchParams.set('limit', String(opts.limit ?? 20));
    const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Remotive ${res.status}`);
    const data = (await res.json()) as { jobs?: unknown[] };
    return (data.jobs ?? []).map((r) => normalizeRemotive(r));
  } };
}
```
- [ ] **Step 4: Run — expect PASS.**  **Step 5: Commit** — `feat(api): Adzuna + Remotive job sources with key-based selection`

### Task F4: saved-search store (dual-mode)
**Files:** Create `data/saved-search-store.ts` + `data/saved-search-store.postgres.ts` (+ test in file mode). Follow `report-store.ts`/`report-store.postgres.ts`.

- [ ] **Step 1–2:** Failing test: `createSavedSearch(userId, {query})`, `listSavedSearches(userId)`, `deleteSavedSearch(userId, id)` round-trip in file mode; user scoping enforced.
- [ ] **Step 3: Implement** — interface `SavedSearch { id; userId; query; location?; remoteOnly; createdAt; updatedAt }`. File mode: JSON file under `apps/api/data/saved-searches.json` (gitignored — add to `.gitignore`). Postgres mode (when `DATABASE_URL`):
```sql
insert into saved_searches (user_id, query, location, remote_only) values ($1,$2,$3,$4) returning *;
select * from saved_searches where user_id = $1 order by created_at desc;
delete from saved_searches where user_id = $1 and id = $2;
```
- [ ] **Step 4–5:** Run PASS; commit `feat(api): saved-search store (file + postgres)`

### Task F5: discovery service (pure orchestration, TDD)
**Files:** Create `lib/discovery.ts` (+ test with injected deps)

- [ ] **Step 1–2:** Failing test: given a fake source returning 3 jobs (one duplicating an existing job URL), `runDiscoveryForUser` inserts 2, skips 1, returns `{inserted:2, skipped:1, source}`.
- [ ] **Step 3: Implement**
```ts
import type { JobSource } from '@/lib/job-sources';
import { dedupKey } from '@/lib/job-sources/normalize';
import { createJob, listJobs } from '@/data/job-store';
import { listSavedSearches } from '@/data/saved-search-store';

export interface DiscoveryDeps { source: JobSource; listJobs: typeof listJobs; createJob: typeof createJob; listSavedSearches: typeof listSavedSearches; }
export async function runDiscoveryForUser(userId: string, deps: DiscoveryDeps) {
  const searches = await deps.listSavedSearches(userId);
  const existing = new Set((await deps.listJobs(userId)).map((j) => (j.jobUrl ?? `${j.company}|${j.title}|${j.location}`).toLowerCase()));
  let inserted = 0, skipped = 0;
  for (const s of searches) {
    const found = await deps.source.search(s.query, { location: s.location, remoteOnly: s.remoteOnly, limit: 20 });
    for (const job of found) {
      const key = dedupKey(job);
      if (existing.has(key)) { skipped++; continue; }
      existing.add(key);
      await deps.createJob(userId, job);
      inserted++;
    }
  }
  return { inserted, skipped, source: deps.source.name };
}
```
- [ ] **Step 4–5:** Run PASS; commit `feat(api): discovery orchestration with per-user dedup`

### Task F6: discovery + saved-search routes
**Files:** Create `routes/discovery.ts`; Modify `app.ts` (mount); Test `routes/discovery.test.ts`

- [ ] **Step 1–2:** Failing route tests (supertest-style, matching existing route tests): `POST /api/discovery/run` requires user (401 without); `GET/POST/DELETE /api/saved-searches` user-scoped; `POST /api/discovery/run-all` rejects without the n8n secret.
- [ ] **Step 3: Implement** — user routes use `requireUser`; `run-all` mounts behind `requireN8nWebhookSecret` and iterates users (Postgres: `select distinct user_id from saved_searches`; file mode: from the store). Use `getJobSource()`.
- [ ] **Step 4–5:** Run PASS; commit `feat(api): discovery + saved-search routes`. Run `npm run check`.

### Task F7: web — saved searches, "Discover now", source badge
**Files:** Modify `apps/web` Settings page, a Jobs/dashboard action, job row component, `.env.example`. Create n8n export.
- [ ] Add a Settings card to CRUD saved searches (via `/api/proxy/saved-searches`).
- [ ] Add a "Discover now" button (calls `/api/proxy/discovery/run`, toasts `{inserted, skipped}`), and a `source` badge on discovered jobs.
- [ ] Add `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` to `.env.example`; add `workflows/n8n/job-discovery.json` (Schedule → HTTP POST `/api/discovery/run-all` with `X-N8N-Webhook-Secret`) + a short doc.
- [ ] **Verify:** `npm run check` green; manual browser check (dev server) of discover flow. **Commit** — `feat(web): saved searches + discover-now + source badge`.

---

## Workstream B — Langfuse tracing

### Task B1: Langfuse settings + obs module (no-op safe)
**Files:** Modify `app/config.py`; Create `app/obs/__init__.py`, `app/obs/langfuse.py`; Test `tests/test_obs.py`

- [ ] **Step 1: Failing test** — `traced_config("parse-job", None)` returns `{}` when Langfuse env unset (no-op); never raises.
```python
def test_traced_config_noops_without_keys(monkeypatch):
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    from importlib import reload; from app import config as c; reload(c)
    from app.obs import langfuse as lf; reload(lf)
    assert lf.traced_config("parse-job", None) == {}
```
- [ ] **Step 2: Run — expect FAIL** (`pytest tests/test_obs.py -v`).
- [ ] **Step 3: Implement** (confirm Langfuse v3 `CallbackHandler` import path via Context7 first):
```python
# app/config.py — add to Settings:
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_host: str = "https://cloud.langfuse.com"
```
```python
# app/obs/langfuse.py
from __future__ import annotations
import logging
from app.config import settings
logger = logging.getLogger("jobops.agent.obs")

def _enabled() -> bool:
    return bool(settings.langfuse_public_key and settings.langfuse_secret_key)

def _handler():
    if not _enabled():
        return None
    try:
        from langfuse.langchain import CallbackHandler  # v3 path; verify via Context7
        return CallbackHandler()  # reads LANGFUSE_* from env
    except Exception:
        logger.warning("Langfuse handler unavailable; tracing disabled", exc_info=True)
        return None

def traced_config(name: str, session_id: str | None) -> dict:
    h = _handler()
    if h is None:
        return {}
    cfg: dict = {"callbacks": [h], "run_name": name}
    if session_id:
        cfg["metadata"] = {"langfuse_session_id": session_id}
    return cfg
```
- [ ] **Step 4: Run — expect PASS.**  **Step 5: Commit** — `feat(agent): Langfuse settings + no-op-safe obs module`

### Task B2: Thread `config` through chains + endpoints
**Files:** Modify `parse_job.py`, `score_fit.py`, `draft_outreach.py`, `weekly.py`, `agents/runner.py`, `main.py`, `schemas.py`

- [ ] **Step 1–2:** Failing test — `score_fit(req, config={...})` forwards config to `.invoke` (patch `model.with_structured_output(...).invoke` to assert it received `config`).
- [ ] **Step 3: Implement** — each chain gains `config: dict | None = None` and passes `.invoke(messages, config=config or None)`. Add optional `session_id: str | None = None` to request schemas. In `main.py`, build `cfg = traced_config("score-fit", req.session_id)` and pass via `_run(score_fit, req, cfg)` (extend `_run` to forward trailing args).
- [ ] **Step 4–5:** Run agent tests PASS; commit `feat(agent): thread Langfuse trace config through chains and endpoints`.

### Task B3: Manual span around RAG retrieval
**Files:** Modify `app/rag/store.py`; Test `tests/test_rag.py` (no-op path)
- [ ] Wrap the `retrieve(...)` DB query in a Langfuse span (via `app.obs`) capturing `query`, `k`, latency, and returned-chunk count; when Langfuse disabled, behavior is unchanged (span helper is a no-op context manager).
- [ ] **Verify:** `pytest && ruff check app tests` green. **Commit** — `feat(agent): trace RAG retrieval as a Langfuse span`.

### Task B4: local Langfuse via docker-compose + docs
**Files:** Create `docker-compose.yml`; Modify `.env.example` (Langfuse vars), README/ARCHITECTURE.
- [ ] Add a `docker-compose.yml` running Langfuse + its Postgres for local dev; document "Langfuse Cloud (free) for the live demo." Add `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`/`LANGFUSE_HOST` to `.env.example`. Capture a trace screenshot for docs.
- [ ] **Commit** — `docs(agent): local Langfuse compose + tracing setup`.

---

## Workstream A — Eval harness

### Task A1: deps + gold-set fixtures
**Files:** Modify `requirements-dev.txt`/`requirements-rag.txt`; Create `evals/data/parse_job.jsonl`, `evals/data/fit_score.jsonl`
- [ ] Add `ragas` (+ its judge LLM deps) to `requirements-rag.txt`; `langfuse` already added in B. Hand-label ~15–20 examples drawn from **real ingested JDs** (Workstream F) + the sample resume. Each parse-job line: `{"description_text": "...", "expected": {"required_skills": [...], "title": "...", "seniority": "..."}}`. Each fit-score line: `{"resume_text": "...", "description_text": "...", "expected": {"fit_label": 0-100}}`.
- [ ] **Commit** — `chore(evals): add Ragas dep + parse-job/fit-score gold sets`.

### Task A2: deterministic parse-job metrics (TDD, no LLM)
**Files:** Create `evals/metrics/extraction.py`; Test `tests/test_evals.py`
- [ ] **Step 1: Failing test**
```python
from evals.metrics.extraction import skill_prf, exact_match
def test_skill_prf_perfect():
    p, r, f = skill_prf(["python", "rag"], ["RAG", "Python"])  # case-insensitive
    assert (p, r, f) == (1.0, 1.0, 1.0)
def test_exact_match():
    assert exact_match("Senior", "senior") == 1.0
```
- [ ] **Step 2: Run — expect FAIL** (`pytest tests/test_evals.py -v`).
- [ ] **Step 3: Implement** — set-based precision/recall/F1 on lowercased skills; `exact_match` case-insensitive equality.
- [ ] **Step 4–5:** Run PASS; commit `feat(evals): deterministic parse-job extraction metrics`.

### Task A3: Ragas fit-score metrics + runner
**Files:** Create `evals/metrics/ragas_fit.py`, `evals/run.py`
- [ ] Implement (confirm Ragas API via Context7): score faithfulness / answer-relevance / context-recall over fit-score outputs (using the retrieved resume evidence as context), plus Spearman rank-correlation between predicted `fit_score` and `expected.fit_label`. `evals/run.py` loads both gold sets, calls the live chains (skips/xfail when no provider key), computes metrics, and writes `evals/report.json` + a markdown summary; `python -m evals.run` is the entrypoint.
- [ ] **Verify:** `python -m evals.run` against a provider key produces a report; `pytest`/`ruff` green. **Commit** — `feat(evals): Ragas fit-score metrics + report runner`.

### Task A4: report-only CI + EVALS.md seed
**Files:** Create `.github/workflows/evals.yml`, `EVALS.md`
- [ ] **Step 1: CI workflow** — triggers on PRs touching `services/agent/**`, `prompts/**`, `services/agent/evals/data/**`; installs `requirements-dev.txt`+`requirements-rag.txt`; runs `python -m evals.run` with a cheap `JUDGE_MODEL` + a provider key from GitHub secrets; uploads `evals/report.json` as an artifact and posts the markdown to the job summary. **Does not block** (the job is informational; gating is Phase 2).
- [ ] **Step 2:** Seed `EVALS.md` describing the harness, metrics, and how to read the report (full metric table lands in Phase 2).
- [ ] **Verify:** workflow YAML lints; a dry PR shows the eval report in the job summary. **Commit** — `ci(evals): report-only eval job + EVALS.md seed`.

---

## Self-review (spec coverage)
- F (real ingestion): F1–F7 ✓ (saved searches, Adzuna+fallback, dedup, routes, web, n8n sweep).
- B (tracing): B1–B4 ✓ (no-op-safe handler, chain/endpoint threading, RAG span, local compose).
- A (evals): A1–A4 ✓ (gold sets, deterministic + Ragas metrics, runner, report-only CI).
- Graceful degradation: explicit no-op tests in F3/B1; eval xfail without key in A3.
- Deferrals honored: no guardrails/rate-limit/gating/LangGraph/hybrid-RAG here.

**Note:** test-runner syntax (`vitest` vs `node:test`/`tsx`) and exact third-party APIs (Adzuna fields, Langfuse v3 `CallbackHandler`, Ragas metric classes) are confirmed against the repo + Context7 at the first task of each workstream, before writing code.

# Phase 2 — JobRight-style Jobs feed (design)

**Date:** 2026-06-24
**Epic:** #124 · **Phase issue:** #119
**Status:** Approved (brainstorm), pending implementation plan

## Goal

Turn Jobs from a manual CRM into a JobRight-style **feed**: tailored postings
appear regularly, already ranked against the user's resume, filterable by
recency — without manual per-job work. **No accuracy/cost regressions**: the
expensive LLM scoring stays gated behind genuine user interest.

## Locked decisions

1. **Auto-score = free local pre-rank on ingest + full LLM score on first open.**
   Every discovered posting gets an instant, $0 estimated fit at ingest. The
   real 2-call LLM parse+score runs lazily the first time the user opens the
   job, budget-guarded, and is cached. A 50-job sweep costs $0.
2. **Background refresh = external GitHub Actions cron → existing
   `POST /api/n8n/discover`.** No in-app scheduler (survives idle App Service,
   no double-fire). Enabling it in prod requires the owner to set repo secrets.
3. **Criteria capture = new onboarding step 2** (target roles + location +
   remote) that creates the first saved search and runs an initial discovery,
   plus an editable discovery panel inside Jobs.

## Current state (verified)

- Discovery works: `runDiscoveryForUser` (`apps/api/src/lib/discovery.ts`) pulls
  Adzuna/Remotive from `saved_searches`, dedupes by URL **and**
  `company|title|location` fingerprint, inserts via `createJob` with
  `fitScore: null`. Postings already carry `datePosted` + `source`.
- Two entry points: `POST /api/discovery/run` (user) and
  `POST /api/n8n/discover` (n8n-secret-guarded sweep over all users with saved
  searches) — both in `apps/api/src/routes/discovery.ts`, both call
  `runDiscoveryForUser`.
- Full scoring path (to reuse on open): `resolveParsedJob` →
  `groundingFromParsed` → `resolveFitScore` → `saveJobAnalysis`, grounded on the
  user's saved resume (`getUserProfile`), budget-guarded via `reserveAiBudget`
  (`apps/api/src/routes/ai.ts`, the `/score-fit` handler).
- UI: `jobs-table.tsx` has search + status/priority filters and a "via adzuna"
  badge; **no** recency filter or posted date shown. Onboarding
  (`apps/web/src/app/onboarding/page.tsx`) is a single resume step.
- `saved_searches` already stores `query` / `location` / `remoteOnly` — reuse,
  **no migration**.

## Architecture

### Auto-score lifecycle

```
Discover (manual "Discover now" OR cron sweep)
   └─► runDiscoveryForUser(userId, { ..., getResume })
          fetch resume ONCE per run (getUserProfile)
          for each NEW posting:
             computeLocalFit(descriptionText, resumeText)
                └─► fitScore + analysis{ matchedSkills, modelUsed: 'local-prerank' }
   ▼
Feed shows estimated fit immediately (labeled "estimated")
   │
User opens job
   └─► analysis.modelUsed === 'local-prerank' && reserveAiBudget(parse) ?
          └─► full LLM parse + score (once) ─► saveJobAnalysis (real fit, cached)
          else ─► stays estimated; manual "Score fit" button remains
```

The `local-prerank` sentinel in `analysis.modelUsed` is the single source of
truth for "estimated vs. real" — no schema change.

### New pure module — `apps/api/src/lib/local-fit.ts`

```
computeLocalFit(descriptionText: string, resumeText: string)
  → { score: number; matchedSkills: string[] }
```

- Extract skill keywords from the description (reuse the existing keyword list /
  parse helper), intersect with keywords present in the resume, scale overlap to
  0–100. Deterministic, no LLM, no I/O. Fully unit-testable.
- Edge cases: empty resume → `score 0`, `matchedSkills []`; no overlap → `0`;
  full overlap → high but capped at 100.

### Ingest wiring

- Extend `DiscoveryDeps` with a `getResume(userId)` dependency (defaults to
  `getUserProfile`). `runDiscoveryForUser` fetches the resume once, and for each
  inserted posting computes local fit and persists `fitScore` + a provisional
  `analysis` (matched skills + `modelUsed: 'local-prerank'`).
- Because both `/api/discovery/run` and `/api/n8n/discover` route through
  `runDiscoveryForUser`, pre-rank applies to manual and scheduled discovery
  alike with no per-route code.
- A posting with no resume on file still inserts (fit `0`/estimated); it upgrades
  on open once a resume exists.

### Score-on-open upgrade

- The upgrade is triggered **client-side**, once, on the job detail component's
  mount (a small effect), only when `analysis.modelUsed === 'local-prerank'` —
  so SSR renders, link prefetches, and bots never spend budget. It calls the
  existing `/score-fit` endpoint, which already reuses `reserveAiBudget`, so a
  user at the daily cap simply keeps the estimate; the manual "Score fit" button
  (Phase 1) is the fallback. Idempotent: a job already upgraded (real
  `modelUsed`) never re-fires, and a concurrent manual click is harmless
  (same endpoint, same cached result).

### Frontend

- **Onboarding step 2** — `onboarding/page.tsx` becomes two steps (resume →
  target criteria). Step 2 captures roles/keywords + location + remote toggle →
  `createSavedSearch` → `runDiscovery` → route to `/jobs`.
- **Discovery panel in Jobs** — relocate `SavedSearchesManager` from Settings
  into the Jobs page (collapsible panel above the table); remove the Settings
  copy (redirect/point to Jobs). Manual search retained.
- **Jobs table** (`jobs-table.tsx`) — add a recency `select`
  (**All / 24h / 3d / 7d**) filtering on `datePosted` (fallback
  `discoveredAt`); show posted date + source; add a matched-skills snippet and
  an **"estimated"** tag when `modelUsed === 'local-prerank'`.

### Background refresh

- `.github/workflows/discover.yml`: cron every 6h →
  `POST {API_BASE_URL}/api/n8n/discover` with the n8n webhook secret header.
  Committed but inert until the owner sets repo secrets `API_BASE_URL` and
  `N8N_WEBHOOK_SECRET`. Documented in the PR and `docs/`.

## Data model

No migrations. Reuse: `saved_searches` (query/location/remoteOnly),
`jobs.fit_score`, `job_analysis` (with `model_used = 'local-prerank'` sentinel),
`jobs.date_posted`, `jobs.source`. No per-user discovery timestamp (cron owns
scheduling).

## Build slices — 4 PRs off `main`, each independently green

| PR | Scope | Layer |
|----|-------|-------|
| **A** | `local-fit.ts` + pre-rank wired into ingest + score-on-open upgrade. Carries this spec. | backend (TDD) |
| **B** | Discovery panel → Jobs; onboarding step 2 + initial discovery | frontend |
| **C** | Recency filter + posted date + matched-skills/"estimated" on rows | frontend |
| **D** | GitHub Actions cron workflow + docs | ops |

## Testing

- `local-fit.test.ts` — pure: empty resume, zero overlap, full overlap, scaling/cap.
- Discovery tests — ingest sets `fitScore` + `local-prerank` sentinel (manual + sweep).
- Score-on-open — estimated → real upgrade; budget-exhausted stays estimated; no re-fire when already real.
- Web (vitest) — onboarding step 2 flow, recency filter logic, discovery-panel render, "estimated" tag.

## YAGNI (explicitly out of scope)

No new DB tables, no in-app scheduler, no per-user discovery timestamps, no
re-ranking of already-scored jobs, no change to the dedupe/source pipeline.

## Workflow

Branch each slice off `main`; one PR per slice; address Codex review before
proceeding; owner does the final merge. Verify per `docs/TESTING.md`.

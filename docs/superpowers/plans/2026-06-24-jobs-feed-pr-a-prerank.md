# Jobs Feed — PR A (local pre-rank + ingest + score-on-open) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every discovered job gets a free, instant estimated fit at ingest, and the real LLM fit runs once when the user first opens the job.

**Architecture:** A pure `local-fit` module computes a resume↔description keyword-overlap score. `runDiscoveryForUser` applies it to each newly-inserted posting (via the existing `saveJobAnalysis`) and tags the analysis with a `local-prerank` sentinel. The web job-detail page detects that sentinel and fires the existing `/api/ai/score-fit` endpoint once, client-side, to upgrade the estimate to a real LLM score.

**Tech Stack:** TypeScript, Express, node:test + tsx (API), Vitest + Testing Library (web). Spec: `docs/superpowers/specs/2026-06-24-jobs-feed-design.md`.

**Scope:** This is PR A of 4. PRs B (discovery panel + onboarding), C (recency/cards), D (cron) get their own plans.

**Branch:** `feat/jobs-feed-prerank` (already created; carries the spec commit).

---

## File structure

- **Create** `apps/api/src/lib/local-fit.ts` — pure: `computeLocalFit` (overlap math) + `prerankAnalysis` (provisional `JobAnalysis` builder). One responsibility: turn a description + resume into an estimated fit.
- **Create** `apps/api/src/lib/local-fit.test.ts` — unit tests for the above.
- **Modify** `apps/api/src/lib/discovery.ts` — add `getResume` + `saveAnalysis` deps; apply pre-rank after each insert.
- **Modify** `apps/api/src/lib/discovery.test.ts` — update `makeDeps`, assert pre-rank applied.
- **Modify** `apps/api/src/routes/discovery.ts` — wire real default deps (`getUserProfile`, `saveJobAnalysis`).
- **Modify** `apps/web/src/lib/analysis-display.ts` — add `PRERANK_MODEL` + `isPrerankAnalysis`.
- **Modify** `apps/web/src/lib/analysis-display.test.ts` (create if absent) — test the helper.
- **Modify** `apps/web/src/components/job-analysis-actions.tsx` — auto-fire `scoreFit` once on mount when the analysis is a pre-rank estimate.
- **Modify** `apps/web/src/components/job-analysis-actions.test.tsx` — test auto-fire on/off.
- **Modify** `apps/web/src/app/(app)/jobs/[jobId]/page.tsx` — pass `autoScore` to `JobAnalysisActions`.

---

## Task 1: `computeLocalFit` — pure keyword-overlap score

**Files:**
- Create: `apps/api/src/lib/local-fit.ts`
- Test: `apps/api/src/lib/local-fit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/local-fit.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { computeLocalFit } from './local-fit';

test('scores the overlap of resume skills against job skills', () => {
  // Description mentions TypeScript, React, PostgreSQL (3 catalog skills).
  // Resume covers TypeScript + React (2 of 3) → round(2/3*100) = 67.
  const description = 'We use TypeScript, React, and PostgreSQL daily.';
  const resume = 'Senior engineer fluent in TypeScript and React.';

  const { score, matchedSkills } = computeLocalFit(description, resume);

  assert.equal(score, 67);
  assert.deepEqual(matchedSkills.sort(), ['React', 'TypeScript']);
});

test('returns 0 with no resume', () => {
  const result = computeLocalFit('We use TypeScript and React.', '');
  assert.equal(result.score, 0);
  assert.deepEqual(result.matchedSkills, []);
});

test('returns 0 when the description has no recognised skills', () => {
  const result = computeLocalFit('A friendly team that loves coffee.', 'TypeScript React');
  assert.equal(result.score, 0);
  assert.deepEqual(result.matchedSkills, []);
});

test('scores 100 when the resume covers every job skill', () => {
  const result = computeLocalFit('TypeScript and React.', 'TypeScript, React, and more.');
  assert.equal(result.score, 100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && node --import tsx --test --test-concurrency=1 src/lib/local-fit.test.ts`
Expected: FAIL — `Cannot find module './local-fit'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/lib/local-fit.ts`:

```ts
import { extractKeywords } from '@/lib/analysis-core';

/**
 * Free, deterministic fit estimate: the share of a job's recognised skills that
 * also appear in the user's resume. No LLM, no I/O. Used to pre-rank discovered
 * postings on ingest before the (paid) LLM score runs on first open.
 */
export function computeLocalFit(
  descriptionText: string,
  resumeText: string,
): { score: number; matchedSkills: string[] } {
  const jobSkills = extractKeywords(descriptionText);
  if (jobSkills.length === 0) {
    return { score: 0, matchedSkills: [] };
  }

  const resumeLower = resumeText.toLowerCase();
  const matchedSkills = jobSkills.filter((skill) => resumeLower.includes(skill.toLowerCase()));
  const score = Math.round((matchedSkills.length / jobSkills.length) * 100);

  return { score, matchedSkills };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && node --import tsx --test --test-concurrency=1 src/lib/local-fit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/local-fit.ts apps/api/src/lib/local-fit.test.ts
git commit -m "feat(api): computeLocalFit — free resume↔job keyword-overlap score (#119)"
```

---

## Task 2: `prerankAnalysis` — provisional JobAnalysis with the `local-prerank` sentinel

**Files:**
- Modify: `apps/api/src/lib/local-fit.ts`
- Test: `apps/api/src/lib/local-fit.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/lib/local-fit.test.ts`:

```ts
import { PRERANK_MODEL, prerankAnalysis } from './local-fit';

test('prerankAnalysis builds an estimated analysis tagged local-prerank', () => {
  const { fitScore, analysis } = prerankAnalysis(
    'We use TypeScript, React, and PostgreSQL daily.',
    'Senior engineer fluent in TypeScript and React.',
  );

  // Carries the local-fit score …
  assert.equal(fitScore, 67);
  // … the matched skills from the overlap …
  assert.deepEqual(analysis.matchedSkills.sort(), ['React', 'TypeScript']);
  // … parsed required/preferred skills from the description …
  assert.ok(analysis.requiredSkills.length > 0);
  // … and the sentinel that marks it estimated (so the UI can upgrade on open).
  assert.equal(analysis.modelUsed, PRERANK_MODEL);
  assert.equal(PRERANK_MODEL, 'local-prerank');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && node --import tsx --test --test-concurrency=1 src/lib/local-fit.test.ts`
Expected: FAIL — `PRERANK_MODEL`/`prerankAnalysis` not exported.

- [ ] **Step 3: Write minimal implementation**

Edit `apps/api/src/lib/local-fit.ts` — update the import line and append the builder:

Change the import at the top to:

```ts
import { analysisFromParsed, extractKeywords, parseJobDescription } from '@/lib/analysis-core';
import type { JobAnalysis } from '@/types';
```

Append at the end of the file:

```ts
/** Sentinel `modelUsed` value marking an estimated (not-yet-LLM-scored) analysis. */
export const PRERANK_MODEL = 'local-prerank';

/**
 * Build the provisional analysis stored for a freshly-discovered posting: the
 * parsed required/preferred skills (so the detail page isn't empty), the
 * local-fit matched skills + score, tagged with the `local-prerank` sentinel so
 * the job-detail page knows to upgrade it with the real LLM score on first open.
 */
export function prerankAnalysis(
  descriptionText: string,
  resumeText: string,
): { fitScore: number; analysis: JobAnalysis } {
  const { score, matchedSkills } = computeLocalFit(descriptionText, resumeText);
  const base = analysisFromParsed(parseJobDescription(descriptionText));

  return {
    fitScore: score,
    analysis: { ...base, matchedSkills, modelUsed: PRERANK_MODEL },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && node --import tsx --test --test-concurrency=1 src/lib/local-fit.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/local-fit.ts apps/api/src/lib/local-fit.test.ts
git commit -m "feat(api): prerankAnalysis — provisional analysis with local-prerank sentinel (#119)"
```

---

## Task 3: Apply pre-rank inside `runDiscoveryForUser`

**Files:**
- Modify: `apps/api/src/lib/discovery.ts`
- Test: `apps/api/src/lib/discovery.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/api/src/lib/discovery.test.ts`, replace the `makeDeps` helper (lines 16–31) with a version that supplies the two new deps, returns created jobs with ids, and records saved analyses:

```ts
function makeDeps(
  found: SourcedJob[],
  existing: Partial<JobRecord>[],
  resume = 'TypeScript and React engineer.',
): {
  deps: DiscoveryDeps;
  created: CreateJobBody[];
  analyses: Array<{ jobId: string; fitScore?: number | null; modelUsed: string }>;
} {
  const created: CreateJobBody[] = [];
  const analyses: Array<{ jobId: string; fitScore?: number | null; modelUsed: string }> = [];
  let n = 0;
  const deps: DiscoveryDeps = {
    source: { name: 'adzuna', search: async () => found },
    listJobs: async () => existing as unknown as JobRecord[],
    createJob: async (_userId, body) => {
      created.push(body);
      n += 1;
      return { ...(body as object), id: `job-${n}` } as unknown as JobRecord;
    },
    listSavedSearches: async () => [SEARCH],
    getResume: async () => resume,
    saveAnalysis: async (_userId, jobId, analysis, fitScore) => {
      analyses.push({ jobId, fitScore, modelUsed: analysis.modelUsed });
      return undefined;
    },
  };
  return { deps, created, analyses };
}
```

Then append a new test:

```ts
test('pre-ranks each inserted job with a local-prerank analysis', async () => {
  const { deps, analyses } = makeDeps(
    [sourced('https://x/1', { descriptionText: 'We use TypeScript and React.' })],
    [],
  );

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 1);
  assert.equal(analyses.length, 1);
  assert.equal(analyses[0]?.jobId, 'job-1');
  assert.equal(analyses[0]?.modelUsed, 'local-prerank');
  assert.equal(typeof analyses[0]?.fitScore, 'number');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && node --import tsx --test --test-concurrency=1 src/lib/discovery.test.ts`
Expected: FAIL — `getResume`/`saveAnalysis` not in `DiscoveryDeps` (type error) and the new assertions fail.

- [ ] **Step 3: Write minimal implementation**

Edit `apps/api/src/lib/discovery.ts`.

Update the imports at the top:

```ts
import {
  createJob as createJobStore,
  listJobs as listJobsStore,
  saveJobAnalysis as saveJobAnalysisStore,
} from '@/data/job-store';
import { listSavedSearches as listSavedSearchesStore } from '@/data/saved-search-store';
import { prerankAnalysis } from '@/lib/local-fit';
import type { JobSource } from '@/lib/job-sources';
import { dedupKey, fingerprintKey } from '@/lib/job-sources/normalize';
```

Extend the `DiscoveryDeps` interface:

```ts
export interface DiscoveryDeps {
  source: JobSource;
  listJobs: typeof listJobsStore;
  createJob: typeof createJobStore;
  listSavedSearches: typeof listSavedSearchesStore;
  getResume: (userId: string) => Promise<string>;
  saveAnalysis: typeof saveJobAnalysisStore;
}
```

In `runDiscoveryForUser`, fetch the resume once after building `seen`:

```ts
  const searches = await deps.listSavedSearches(userId);
  const seen = new Set((await deps.listJobs(userId)).flatMap(keysFor));
  const resume = await deps.getResume(userId);
```

Replace the successful-insert block (the `try { await deps.createJob(...); inserted += 1; }`) with one that captures the created job and pre-ranks it:

```ts
      try {
        const createdJob = await deps.createJob(userId, job);
        inserted += 1;
        // Pre-rank: store a free estimated fit so the feed is ranked immediately;
        // the real LLM score runs lazily when the user first opens the job.
        const { fitScore, analysis } = prerankAnalysis(job.descriptionText ?? '', resume);
        await deps.saveAnalysis(userId, createdJob.id, analysis, fitScore);
      } catch (error) {
```

(The `catch` body — duplicate-key handling and `throw` — is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && node --import tsx --test --test-concurrency=1 src/lib/discovery.test.ts`
Expected: PASS (all existing tests + the new pre-rank test).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/discovery.ts apps/api/src/lib/discovery.test.ts
git commit -m "feat(api): pre-rank discovered jobs with local fit on ingest (#119)"
```

---

## Task 4: Wire real default deps in the discovery routes

**Files:**
- Modify: `apps/api/src/routes/discovery.ts`

This is production dependency wiring (no new branch logic), verified by the type checker and the existing route tests, which inject their own deps.

- [ ] **Step 1: Update the imports**

Edit `apps/api/src/routes/discovery.ts` top imports:

```ts
import { Router } from 'express';
import { requireUser } from '@/lib/auth';
import { createJob, listJobs, saveJobAnalysis } from '@/data/job-store';
import { getUserProfile } from '@/data/profile-store';
import { listSavedSearches, listUsersWithSavedSearches } from '@/data/saved-search-store';
import { getJobSource } from '@/lib/job-sources';
import { requireN8nWebhookSecret } from '@/lib/n8n';
import { runDiscoveryForUser, type DiscoveryResult } from '@/lib/discovery';
```

- [ ] **Step 2: Wire the new deps into `defaultDeps`**

Replace the `runDiscovery` field of `defaultDeps`:

```ts
const defaultDeps: DiscoveryRouterDeps = {
  runDiscovery: (userId) =>
    runDiscoveryForUser(userId, {
      source: getJobSource(),
      listJobs,
      createJob,
      listSavedSearches,
      getResume: async (id) => (await getUserProfile(id))?.resumeText ?? '',
      saveAnalysis: saveJobAnalysis,
    }),
  listUsersWithSavedSearches,
};
```

- [ ] **Step 3: Verify typecheck + discovery route tests pass**

Run: `cd apps/api && npm run typecheck`
Expected: no errors.

Run: `cd apps/api && node --import tsx --test --test-concurrency=1 src/routes/discovery.test.ts`
Expected: PASS (unchanged — route tests inject their own deps).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/discovery.ts
git commit -m "feat(api): wire resume + analysis deps into discovery defaults (#119)"
```

---

## Task 5: Web — recognise the `local-prerank` sentinel

**Files:**
- Modify: `apps/web/src/lib/analysis-display.ts`
- Test: `apps/web/src/lib/analysis-display.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/analysis-display.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PRERANK_MODEL, isPrerankAnalysis, isHeuristicAnalysis } from './analysis-display';

describe('isPrerankAnalysis', () => {
  it('is true only for the local-prerank sentinel', () => {
    expect(PRERANK_MODEL).toBe('local-prerank');
    expect(isPrerankAnalysis('local-prerank')).toBe(true);
    expect(isPrerankAnalysis('mock-analysis-v1')).toBe(false);
    expect(isPrerankAnalysis(null)).toBe(false);
    expect(isPrerankAnalysis(undefined)).toBe(false);
  });

  it('does not classify the pre-rank sentinel as a heuristic fit', () => {
    expect(isHeuristicAnalysis('local-prerank')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/analysis-display.test.ts`
Expected: FAIL — `PRERANK_MODEL`/`isPrerankAnalysis` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/web/src/lib/analysis-display.ts`:

```ts
/**
 * `local-prerank` marks a discovered job's free, estimated fit (keyword overlap
 * only). It upgrades to a real LLM analysis the first time the job is opened.
 */
export const PRERANK_MODEL = 'local-prerank';

export function isPrerankAnalysis(modelUsed: string | null | undefined): boolean {
  return modelUsed === PRERANK_MODEL;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/lib/analysis-display.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/analysis-display.ts apps/web/src/lib/analysis-display.test.ts
git commit -m "feat(web): recognise local-prerank estimated-analysis sentinel (#119)"
```

---

## Task 6: Web — auto-fire `scoreFit` once on open for estimated jobs

**Files:**
- Modify: `apps/web/src/components/job-analysis-actions.tsx`
- Test: `apps/web/src/components/job-analysis-actions.test.tsx`

- [ ] **Step 1: Write the failing test**

Replace the body of `apps/web/src/components/job-analysis-actions.test.tsx` with:

```tsx
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const { scoreFit } = vi.hoisted(() => ({
  scoreFit: vi.fn(() => Promise.resolve({ fit_score: 80 })),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/api', () => ({
  scoreFit,
  ApiRequestError: class ApiRequestError extends Error {},
}));

import { JobAnalysisActions } from './job-analysis-actions';

afterEach(() => {
  vi.clearAllMocks();
});

it('offers a single "Score fit" action and no separate "Parse job" button', () => {
  render(<JobAnalysisActions jobId="job-1" />);

  expect(screen.getByRole('button', { name: /score fit/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /parse job/i })).not.toBeInTheDocument();
});

it('does not auto-score by default', () => {
  render(<JobAnalysisActions jobId="job-1" />);
  expect(scoreFit).not.toHaveBeenCalled();
});

it('auto-scores once on mount when the analysis is an estimate', async () => {
  render(<JobAnalysisActions jobId="job-1" autoScore />);
  await waitFor(() => expect(scoreFit).toHaveBeenCalledTimes(1));
  expect(scoreFit).toHaveBeenCalledWith({ jobId: 'job-1' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/components/job-analysis-actions.test.tsx`
Expected: FAIL — `autoScore` prop has no effect; `scoreFit` not called.

- [ ] **Step 3: Write minimal implementation**

Replace `apps/web/src/components/job-analysis-actions.tsx` with:

```tsx
'use client';

import { Target } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ApiRequestError, scoreFit } from '@/lib/api';

type JobAnalysisActionsProps = {
  jobId: string;
  /** True when the stored analysis is a free estimate (local-prerank): upgrade it
   *  to a real LLM score once, silently, on open. */
  autoScore?: boolean;
};

// "Score fit" is the single analysis action: it parses the job and scores the
// fit in one step, then persists the scored analysis. (The old "Parse job"
// button saved a fit-less heuristic that overwrote a good score — removed.)
export function JobAnalysisActions({ jobId, autoScore = false }: JobAnalysisActionsProps) {
  const router = useRouter();
  const [isScoring, setIsScoring] = useState(false);
  const autoFired = useRef(false);

  async function handleScore({ silent = false }: { silent?: boolean } = {}) {
    setIsScoring(true);
    try {
      const scored = await scoreFit({ jobId });
      if (!silent) toast.success(`Fit score saved: ${scored.fit_score}/100`);
      router.refresh();
    } catch (error) {
      // The automatic upgrade stays quiet on failure (e.g. daily budget reached):
      // the estimate remains and the manual button is the fallback.
      if (!silent) {
        toast.error(error instanceof ApiRequestError ? error.message : 'Failed to score the fit.');
      }
    } finally {
      setIsScoring(false);
    }
  }

  useEffect(() => {
    if (autoScore && !autoFired.current) {
      autoFired.current = true;
      void handleScore({ silent: true });
    }
    // Fire at most once per mount for an estimated job; jobId/autoScore are stable
    // for the lifetime of the detail page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScore, jobId]);

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => void handleScore()} disabled={isScoring} className="gap-1.5">
        <Target className="size-4" />
        {isScoring ? 'Scoring…' : 'Score fit'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/components/job-analysis-actions.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/job-analysis-actions.tsx apps/web/src/components/job-analysis-actions.test.tsx
git commit -m "feat(web): auto-upgrade estimated fit to a real LLM score on open (#119)"
```

---

## Task 7: Web — pass `autoScore` from the job-detail page + full verification

**Files:**
- Modify: `apps/web/src/app/(app)/jobs/[jobId]/page.tsx`

- [ ] **Step 1: Pass the `autoScore` prop**

In `apps/web/src/app/(app)/jobs/[jobId]/page.tsx`:

Update the analysis-display import (line 16) to also import the pre-rank helper:

```ts
import { isHeuristicAnalysis, isPrerankAnalysis } from '@/lib/analysis-display';
```

After the `heuristic` line (line 36), add:

```ts
  const estimated = isPrerankAnalysis(job.analysis.modelUsed);
```

Update the `JobAnalysisActions` usage (line 64):

```tsx
          <JobAnalysisActions jobId={job.id} autoScore={estimated} />
```

- [ ] **Step 2: Typecheck, lint, and run the web test suite**

Run: `cd apps/web && npm run typecheck`
Expected: no errors.

Run: `cd apps/web && npm run lint`
Expected: no errors.

Run: `cd apps/web && npm test`
Expected: all suites PASS (including the new `analysis-display` + `job-analysis-actions` tests).

- [ ] **Step 3: Run the full API test suite**

Run: `cd apps/api && node scripts/run-tests.mjs`
Expected: all PASS (110 prior + new local-fit + discovery pre-rank tests).

- [ ] **Step 4: Build the web app**

Run: `cd apps/web && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit and push**

```bash
git add "apps/web/src/app/(app)/jobs/[jobId]/page.tsx"
git commit -m "feat(web): trigger score-on-open for estimated discovered jobs (#119)"
git push -u origin feat/jobs-feed-prerank
```

- [ ] **Step 6: Open the PR**

```bash
gh pr create --title "feat: pre-rank discovered jobs + score-on-open (#118 → #119 · PR A)" \
  --body "$(cat <<'BODY'
Phase 2 PR A — the auto-score lifecycle for the Jobs feed.

- New pure `local-fit.ts`: `computeLocalFit` (resume↔job keyword overlap) + `prerankAnalysis` (provisional analysis tagged `local-prerank`).
- `runDiscoveryForUser` pre-ranks every newly inserted posting (free, $0) so the feed is ranked on ingest — applies to both `/api/discovery/run` and the `/api/n8n/discover` sweep.
- Job-detail page auto-fires the existing `/api/ai/score-fit` once, client-side, to upgrade an estimate to a real LLM score (budget-guarded; silent on failure; manual "Score fit" remains the fallback).

Spec: `docs/superpowers/specs/2026-06-24-jobs-feed-design.md`.

Verification: API suite + web vitest + typecheck + lint + build all green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Self-review notes

- **Spec coverage:** PR A rows of the spec table — `local-fit.ts` (Tasks 1–2), pre-rank wired into ingest (Tasks 3–4), score-on-open upgrade (Tasks 5–7). PRs B/C/D are intentionally out of scope.
- **Type consistency:** `PRERANK_MODEL = 'local-prerank'` defined once per side (`local-fit.ts` API, `analysis-display.ts` web); `prerankAnalysis` returns `{ fitScore, analysis }`; `saveAnalysis` matches `saveJobAnalysis(userId, jobId, analysis, fitScore?)`; `DiscoveryDeps.getResume` returns `Promise<string>`.
- **No placeholders:** every code step shows full code; commands include expected output.
- **Cost guard:** the only paid call (`scoreFit`) is gated behind client mount + the existing `reserveAiBudget` in `/score-fit`; ingest is free.

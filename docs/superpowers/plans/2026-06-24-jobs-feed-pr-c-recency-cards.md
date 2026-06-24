# Jobs Feed — PR C (recency filters + posted date + matched-skills/"estimated" cards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Jobs list feel like a feed: filter by recency, show when a posting was published and where it came from, and surface the fit signal (matched skills + an "estimated" tag for not-yet-LLM-scored jobs).

**Architecture:** A pure `job-recency` helper does the date-window math (unit-tested in isolation). `JobsTable` gains a recency `<select>` that filters on `datePosted ?? discoveredAt`, plus per-row posted date, source, an "Estimated" badge (reusing `isPrerankAnalysis` from PR A), and a matched-skills snippet.

**Tech Stack:** Next.js client component, React, Vitest + Testing Library. Spec: `docs/superpowers/specs/2026-06-24-jobs-feed-design.md` (tasks 2.5, 2.6).

**Branch:** `feat/jobs-feed-pr-c` (already created). **Scope:** PR C of 4. Out of scope: cron (PR D).

---

## Task 1: Pure recency helper

**Files:**
- Create: `apps/web/src/lib/job-recency.ts`
- Test: `apps/web/src/lib/job-recency.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/job-recency.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isWithinRecency, RECENCY_OPTIONS } from './job-recency';

const NOW = Date.parse('2026-06-24T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

describe('isWithinRecency', () => {
  it('keeps everything for the "all" window', () => {
    expect(isWithinRecency({ discoveredAt: hoursAgo(1000) }, 'all', NOW)).toBe(true);
  });

  it('uses datePosted when present, falling back to discoveredAt', () => {
    expect(isWithinRecency({ datePosted: hoursAgo(2), discoveredAt: hoursAgo(500) }, '24h', NOW)).toBe(true);
    expect(isWithinRecency({ discoveredAt: hoursAgo(2) }, '24h', NOW)).toBe(true);
  });

  it('excludes postings older than the window', () => {
    expect(isWithinRecency({ datePosted: hoursAgo(25) }, '24h', NOW)).toBe(false);
    expect(isWithinRecency({ datePosted: hoursAgo(24 * 4) }, '3d', NOW)).toBe(false);
    expect(isWithinRecency({ datePosted: hoursAgo(24 * 6) }, '7d', NOW)).toBe(true);
  });

  it('excludes rows with no usable date (except for "all")', () => {
    expect(isWithinRecency({}, '24h', NOW)).toBe(false);
    expect(isWithinRecency({ datePosted: 'not-a-date' }, '24h', NOW)).toBe(false);
    expect(isWithinRecency({}, 'all', NOW)).toBe(true);
  });

  it('exposes selectable options with an "all" default first', () => {
    expect(RECENCY_OPTIONS[0]).toEqual({ value: 'all', label: 'Any time' });
    expect(RECENCY_OPTIONS.map((o) => o.value)).toEqual(['all', '24h', '3d', '7d']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npx vitest run src/lib/job-recency.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/job-recency.ts`:

```ts
export type RecencyWindow = 'all' | '24h' | '3d' | '7d';

export const RECENCY_OPTIONS: ReadonlyArray<{ value: RecencyWindow; label: string }> = [
  { value: 'all', label: 'Any time' },
  { value: '24h', label: 'Last 24h' },
  { value: '3d', label: 'Last 3 days' },
  { value: '7d', label: 'Last 7 days' },
];

const WINDOW_MS: Record<Exclude<RecencyWindow, 'all'>, number> = {
  '24h': 24 * 3600_000,
  '3d': 3 * 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
};

/** The date a posting is ranked by: when it was posted, else when we discovered it. */
export function recencyDate(job: { datePosted?: string; discoveredAt?: string }): string | undefined {
  return job.datePosted ?? job.discoveredAt;
}

/** True when the job's effective date falls inside the window relative to `nowMs`. */
export function isWithinRecency(
  job: { datePosted?: string; discoveredAt?: string },
  window: RecencyWindow,
  nowMs: number,
): boolean {
  if (window === 'all') return true;
  const date = recencyDate(job);
  if (!date) return false;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return false;
  return t >= nowMs - WINDOW_MS[window];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npx vitest run src/lib/job-recency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot" && git add apps/web/src/lib/job-recency.ts apps/web/src/lib/job-recency.test.ts && git commit -F - <<'EOF'
feat(web): pure recency-window helper for the jobs feed (#119)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YY7NVS3QLuFeTqkmBaidAB
EOF
```

---

## Task 2: JobsTable — recency filter + posted date + source + estimated tag + matched skills

**Files:**
- Modify: `apps/web/src/components/jobs-table.tsx`
- Test: `apps/web/src/components/jobs-table.test.tsx`

The table gains a recency `<select>` (alongside status/priority), a per-row posted date + an "Estimated" badge when `isPrerankAnalysis(job.analysis.modelUsed)`, and a matched-skills snippet under the company line. The existing "via {source}" badge stays.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/components/jobs-table.test.tsx` (keep the existing `makeJob` + two tests):

```ts
it('filters by recency on datePosted (falling back to discoveredAt)', async () => {
  const now = Date.now();
  const recent = makeJob({
    company: 'RecentCo',
    title: 'Fresh Role',
    datePosted: new Date(now - 2 * 3600_000).toISOString(),
  });
  const stale = makeJob({
    company: 'StaleCo',
    title: 'Old Role',
    datePosted: new Date(now - 10 * 24 * 3600_000).toISOString(),
  });

  const user = userEvent.setup();
  render(<JobsTable jobs={[recent, stale]} />);

  // Both visible under the default "Any time" window.
  expect(screen.getByText('Fresh Role')).toBeInTheDocument();
  expect(screen.getByText('Old Role')).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText(/filter by recency/i), '24h');

  expect(screen.getByText('Fresh Role')).toBeInTheDocument();
  expect(screen.queryByText('Old Role')).not.toBeInTheDocument();
});

it('marks an estimated (local-prerank) job and lists its matched skills', () => {
  const job = makeJob({
    company: 'EstimateCo',
    title: 'Estimated Role',
    analysis: {
      requiredSkills: [],
      preferredSkills: [],
      matchedSkills: ['TypeScript', 'React'],
      missingSkills: [],
      atsKeywords: [],
      fitSummary: '',
      recommendedResumeAngle: '',
      applyRecommendation: '',
      confidenceScore: 0,
      modelUsed: 'local-prerank',
    },
  });

  render(<JobsTable jobs={[job]} />);

  expect(screen.getByText(/estimated/i)).toBeInTheDocument();
  expect(screen.getByText(/TypeScript/)).toBeInTheDocument();
});
```

Also add the userEvent import at the top of the test file if missing:
```ts
import userEvent from '@testing-library/user-event';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npx vitest run src/components/jobs-table.test.tsx`
Expected: FAIL — no recency select, no "Estimated" badge, matched skills not rendered.

- [ ] **Step 3: Implement**

In `apps/web/src/components/jobs-table.tsx`:

1. Add imports:
```ts
import { isPrerankAnalysis } from '@/lib/analysis-display';
import { isWithinRecency, RECENCY_OPTIONS, recencyDate, type RecencyWindow } from '@/lib/job-recency';
```
(`formatDate` is already imported.)

2. Add recency state next to the others:
```ts
  const [recency, setRecency] = useState<RecencyWindow>('all');
```

3. Include recency in `clearFilters`:
```ts
  function clearFilters() {
    setQuery('');
    setStatus('all');
    setPriority('all');
    setRecency('all');
  }
```

4. Compute `nowMs` once above the filter, and add the recency predicate:
```ts
  const nowMs = Date.now();
  const filteredJobs = jobs.filter((job) => {
    const matchesQuery = /* unchanged */;
    const matchesStatus = status === 'all' || job.status === status;
    const matchesPriority = priority === 'all' || job.priority === priority;
    const matchesRecency = isWithinRecency(job, recency, nowMs);
    return matchesQuery && matchesStatus && matchesPriority && matchesRecency;
  });
```
(Keep the existing `matchesQuery` body.)

5. Add the recency `<select>` after the priority `<select>` (same `selectClass`):
```tsx
          <select
            aria-label="Filter by recency"
            className={selectClass}
            value={recency}
            onChange={(event) => setRecency(event.target.value as RecencyWindow)}
          >
            {RECENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
```

6. In the company/role cell, replace the existing source-badge block:
```tsx
                        {job.source === 'adzuna' || job.source === 'remotive' ? (
                          <Badge variant="outline" className="mt-1 text-[10px] font-normal capitalize">
                            via {job.source}
                          </Badge>
                        ) : null}
```
with a meta line that adds the posted date + Estimated badge, and a matched-skills snippet below it:
```tsx
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          {job.source === 'adzuna' || job.source === 'remotive' ? (
                            <Badge variant="outline" className="text-[10px] font-normal capitalize">
                              via {job.source}
                            </Badge>
                          ) : null}
                          {isPrerankAnalysis(job.analysis.modelUsed) ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500/40 text-amber-700 text-[10px] font-normal dark:text-amber-400"
                            >
                              Estimated
                            </Badge>
                          ) : null}
                          <span className="text-muted-foreground text-[11px]">
                            Posted {formatDate(recencyDate(job))}
                          </span>
                        </span>
                        {job.analysis.matchedSkills.length > 0 ? (
                          <span className="text-muted-foreground mt-1 block truncate text-[11px]">
                            Matches: {job.analysis.matchedSkills.slice(0, 3).join(' · ')}
                            {job.analysis.matchedSkills.length > 3
                              ? ` +${job.analysis.matchedSkills.length - 3}`
                              : ''}
                          </span>
                        ) : null}
```
(The surrounding `<span className="min-w-0">` already wraps these — keep them inside it, after the company·location line.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npx vitest run src/components/jobs-table.test.tsx`
Expected: PASS (4 tests).

Then: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npm run lint && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot" && git add apps/web/src/components/jobs-table.tsx apps/web/src/components/jobs-table.test.tsx && git commit -F - <<'EOF'
feat(web): recency filter + posted date + matched-skills/estimated on jobs (#119)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YY7NVS3QLuFeTqkmBaidAB
EOF
```

---

## Task 3: Full verification + open PR

- [ ] **Step 1: Full web suite + build**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npm test`
Expected: all PASS.

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npm run build`
Expected: build succeeds.

- [ ] **Step 2: Push + open PR**

```bash
cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot" && git push -u origin feat/jobs-feed-pr-c
```
Open the PR (base `main`), title `feat: jobs recency filter + posted date + matched-skills/estimated cards (#118 → #119 · PR C)`, body summarising the changes, ending with the Generated-with line.

---

## Self-review notes
- **Spec coverage:** 2.5 (recency filter + posted date + source) = Tasks 1 & 2; 2.6 (matched skills + estimated tag) = Task 2.
- **Type consistency:** `RecencyWindow`, `RECENCY_OPTIONS`, `isWithinRecency`, `recencyDate` are defined in `job-recency.ts` and consumed in `jobs-table.tsx`. `isPrerankAnalysis` reused from `@/lib/analysis-display`.
- **No placeholders:** code shown in full; `matchesQuery` body intentionally unchanged (referenced, not rewritten).
- **No-date safety:** `isWithinRecency` returns false for unusable dates except `all`; `formatDate(undefined)` already returns a fallback string.

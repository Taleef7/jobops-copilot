# Infra + UX Hardening — Design Spec
_2026-06-29_

Two workstreams: (1) make `db:init` safe to re-run via migration tracking, and (2) close the remaining J6–J10 UX/a11y backlog items from the round-2 audit.

---

## 1. `db:init` Migration Tracking

### Problem
`apps/api/scripts/db-init.ts` runs every `.sql` file in `db/migrations/` in alphabetical order on every invocation, with no record of what has already been applied. Re-running against prod fails on `002_weekly_report_storage.sql` because the table now has duplicate rows that block a unique-index creation — even though the schema is otherwise correct.

### Approach: `schema_migrations` tracking table

The standard pattern (Rails, Flyway, Liquibase). One new Postgres table records which migration filenames have been applied; the script skips any that are already recorded.

#### Schema

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   text        PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
```

The table itself is created idempotently by the script before processing any migration file.

#### Bootstrap detection (first run on an existing DB)

If `schema_migrations` is empty **and** the `jobs` table already exists, the DB was migrated before tracking was added. In that case, all current migration filenames are pre-seeded as applied (`INSERT … ON CONFLICT DO NOTHING`) so the first tracked run skips everything rather than re-running 001–009 against prod data.

#### Per-migration flow

For each `.sql` file (sorted alphabetically, same order as today):
1. Query `schema_migrations` for the filename.
2. If present → log `Skipping already-applied migration <filename>` and continue.
3. If absent → run the SQL **inside a transaction** (BEGIN … COMMIT). On success, insert the filename into `schema_migrations` inside the same transaction. On failure, roll back — the migration is neither applied nor recorded, so the next run retries it cleanly.

#### Hardening
- Migration run + tracking insert share one transaction: a crash between them is impossible.
- The bootstrap pre-seed uses `ON CONFLICT DO NOTHING` so it is safe to run concurrently or more than once.
- Logging clearly distinguishes `Skipping`, `Running`, and `Finished` so operators can audit what happened.
- No changes to any `.sql` migration file.

#### Tests
- Unit test the new logic in `db-init.ts` by injecting a mock `Pool` (or a real local PG in CI if available): verify skip when recorded, verify record-on-success, verify no record on failure.
- Alternatively, document the test as an integration test that relies on the existing CI Postgres job.

---

## 2. J6 — Job-Create Form A11y

**File:** `apps/web/src/components/job-create-form.tsx`

### Changes

| Field | Fix |
|-------|-----|
| All text inputs | Add `name` + `autocomplete` attributes matching their semantic purpose (`organization`, `off`, etc.) |
| `jobUrl` | Change to `type="url"` |
| Error messages | Add `id` to each error element; wire `aria-describedby` on the corresponding input; add `aria-invalid="true"` when an error is present |
| Submit validation | On submit failure, `focus()` the first input whose `ref` has an active error — no `querySelector`, refs only |
| Error clearing | Clear an input's error when its value changes (avoids stale "field required" after the user has typed) |

### Hardening
- Error region announces via `aria-live="polite"` on the form's error summary (if one exists) or individual field errors (preferred — already scoped to the field).
- `aria-describedby` is removed when the error is cleared so screen-readers don't announce a missing element.
- `focus()` call is in a `setTimeout(fn, 0)` to ensure React has flushed the DOM before focus is attempted.
- New vitest: submit with blank required fields → first errored field receives focus.

---

## 3. J7 — Assistant "Below the Fit Bar" Dead-End

**File:** `apps/web/src/components/assistant-panel.tsx`

### Problem
When the LangGraph agent takes the `pass` node (fit score below threshold), the step renders with a green `<Check>` icon and the label "Below the fit bar — stopping" — then nothing more. Users have no guidance on what to do next.

### Changes
1. **Icon:** Replace the single `<Check>` icon with a per-step icon: `<Check>` for every node except `pass`, which gets `<X className="… text-destructive" />`.
2. **Guidance:** After the steps list, when any step has `node === 'pass'`, render a callout box:
   > "Your profile didn't score high enough for this role's threshold. Common next steps: strengthen your resume for the required skills, or use the **Score fit** button to see exactly what's missing."
   The callout links to the job's detail page analysis section if a `jobId` prop is available; otherwise it's plain text.
3. **No external data needed:** guidance is static — the assistant panel doesn't receive the job object and fetching it here would over-scope this fix.

### Hardening
- The `pass` check is `steps.some(s => s.node === 'pass')` — defensive against the node label changing: also handle `below_fit_bar` as an alias.
- Guidance callout uses `role="status"` so assistive technology announces it when it appears.

---

## 4. J8 — Dashboard "Load Sample Data" Direct Seed

**Files:** `apps/web/src/app/(app)/dashboard/page.tsx` (or the dashboard widget referencing it), `apps/web/src/lib/api.ts`

### Problem
The dashboard shows a "Load sample data" card/button that navigates to `/settings` rather than actually seeding. The seed function (`seedDemoData`) already exists in `lib/api.ts`.

### Change
Replace the `/settings` navigation with an inline seed action:
- Button shows a loading spinner while the call is in-flight.
- On success: `toast.success('Sample data loaded.')` + `router.refresh()` (same pattern as `settings-actions.tsx`).
- On error: `toast.error('Could not load sample data.')`.
- No logic duplication: call the existing `seedDemoData()` from `lib/api.ts` directly.

### Hardening
- Button is `disabled` during loading to prevent double-submit.
- `router.refresh()` ensures the dashboard reflects the newly seeded data without a full page reload.

---

## 5. J9 — Heading Hierarchy + Duplicate Chips

**Files:** `apps/web/src/components/app-header.tsx`, `apps/web/src/app/onboarding/page.tsx`, `apps/web/src/components/jobs-table.tsx`

### 5a. Double `<h1>`

`app-header.tsx:59` renders `<h1>` for the page title on every page. Page content (dashboard, jobs, reports, outreach, settings) often also has a primary heading, creating two `<h1>`s.

**Fix:** Change the header's title element from `<h1>` to `<p>` with identical styling. The `<header>` landmark already identifies the region; it doesn't need an `<h1>`. Individual pages keep their own headings unchanged.

### 5b. Onboarding missing heading

The onboarding page uses `<CardTitle>` (renders as `<div>` inside shadcn's Card) with no semantic heading element.

**Fix:** Wrap the onboarding card's title in a true `<h1>` (styled to match the CardTitle appearance, or replace CardTitle with an `<h1>` that carries the same class). This gives screen-readers a document landmark on that page.

### 5c. Duplicate "Remote · Remote" chips

`jobs-table.tsx:186` displays `{job.location}` alongside the `workplaceType` badge. When a job's `location` field is "Remote" (or case-insensitive variant) and `workplaceType` is also `"remote"`, both render the same concept.

**Fix:** Suppress the location chip when `location.trim().toLowerCase() === 'remote'` and `workplaceType === 'remote'`. Keep the `workplaceType` badge. Add a helper `isDuplicateRemote(location, workplaceType)` so the logic is named and testable.

**New vitest:** `isDuplicateRemote('Remote', 'remote') === true`, `isDuplicateRemote('New York, NY', 'remote') === false`.

---

## 6. J10 — `prefers-reduced-motion`, Export Download, Outreach Expand

### 6a. `prefers-reduced-motion`

**File:** `apps/web/src/app/globals.css`

Add a standard CSS media query at the end of the file:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

This is the well-established WCAG 2.1 AA pattern and overrides both Tailwind and `tw-animate-css` animations for users who have the system preference set.

The existing `motion-reduce:transition-none` Tailwind classes on interactive elements (buttons, widget) already handle Tailwind-generated transitions — this CSS rule acts as the catch-all for library animations.

### 6b. Export as file download

**File:** `apps/web/src/components/settings-actions.tsx` (`ExportDataButton`)

Replace `window.open(url, '_blank')` with a fetch + Blob download:

```typescript
async function exportData() {
  setBusy(true);
  try {
    const response = await fetch('/api/proxy/api/profile/export');
    if (!response.ok) throw new Error(`Export failed: ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'jobops-export.json';
    anchor.click();
    URL.revokeObjectURL(url);
  } catch {
    toast.error('Export failed. Try again.');
  } finally {
    setBusy(false);
  }
}
```

`ExportDataButton` gains `busy` state and a spinner, same pattern as the other action buttons in this file. The `download` attribute triggers a Save dialog rather than opening a new tab.

### 6c. Outreach expand-before-approve

**File:** `apps/web/src/app/(app)/outreach/page.tsx`

The outreach table truncates the message preview to 3 lines (`line-clamp-3`). Users can't read the full message before clicking Approve.

**Fix:** Add an expand/collapse toggle per row:
- Default: collapsed (3-line clamp, "Show full message" link).
- Expanded: full message text in a scrollable container (`max-h-48 overflow-y-auto`), "Collapse" link.
- The Approve/Reject buttons remain visible in both states — the toggle is additive, not a gate.
- Row expand state is local component state (`expandedRows: Set<string>` keyed by outreach id).
- No modal: keeps the table layout intact and avoids blocking keyboard navigation.

### Hardening (J10)
- Export: `setBusy` prevents double-clicks; `URL.revokeObjectURL` runs even on error path (via `finally`-equivalent).
- Outreach expand: `max-h-48 overflow-y-auto` keeps long messages from breaking table layout. Focus is not moved on toggle — the toggle button stays in place.

---

## Branch / PR Strategy

Same pattern as J1–J5: one branch + PR per item, off `main`. Owner merges.

| PR | Scope |
|----|-------|
| A | `db:init` migration tracking (infra) |
| B | J6 job-create form a11y |
| C | J7 assistant pass-node guidance |
| D | J8 dashboard direct seed |
| E | J9 heading hierarchy + duplicate chips |
| F | J10 prefers-reduced-motion + export download + outreach expand |

Each PR: `tsc --noEmit` + `eslint` + vitest/node:test suite green + `next build` clean.

---

## Out of Scope

- "Jobs filters not in URL" (from J10 tracking issue) — meaningful feature, separate backlog item.
- J7 reports reconciliation — already fixed by Phase 1 (live aggregates, no mock fallback).
- Any new features or Phase 7 work.

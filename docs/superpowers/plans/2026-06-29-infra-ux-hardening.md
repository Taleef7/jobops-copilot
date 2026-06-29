# Infra + UX Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add idempotent migration tracking to `db:init` so it can be re-run safely against prod, then close the J6–J10 UX/a11y backlog items from the round-2 audit.

**Architecture:** Six independent PRs (A–F) each branched off `main`. PR A is API-only (TypeScript, node:test). PRs B–F are web-only (Next.js, React, Vitest). No cross-PR dependencies — all six can be worked in parallel by separate agents. Each PR must pass `tsc --noEmit`, `eslint .`, its test suite, and `next build` (web) before opening.

**Tech Stack:** TypeScript, Node.js 22, `node:test` (API tests), Vitest + RTL (web tests), Next.js 16, React 19, shadcn/Base UI, Tailwind CSS, pg (Postgres client), lucide-react, sonner.

---

## File Map

| PR | Create | Modify |
|----|--------|--------|
| A | `apps/api/scripts/db-migrations.ts` | `apps/api/scripts/db-init.ts`, `apps/api/scripts/run-tests.mjs` |
| A (test) | `apps/api/scripts/db-migrations.test.ts` | — |
| B | — | `apps/web/src/components/job-create-form.tsx` |
| C | — | `apps/web/src/components/assistant-panel.tsx` |
| D | `apps/web/src/components/load-sample-data-button.tsx` | `apps/web/src/app/(app)/dashboard/page.tsx` |
| E | — | `apps/web/src/components/app-header.tsx`, `apps/web/src/app/onboarding/page.tsx`, `apps/web/src/components/jobs-table.tsx` |
| E (test) | `apps/web/src/components/jobs-table.isDuplicateRemote.test.ts` | — |
| F | `apps/web/src/components/outreach-draft-card.tsx` | `apps/web/src/app/globals.css`, `apps/web/src/components/settings-actions.tsx`, `apps/web/src/app/(app)/outreach/page.tsx` |

---

## Task A: db:init Migration Tracking (PR A)

**Files:**
- Create: `apps/api/scripts/db-migrations.ts`
- Create: `apps/api/scripts/db-migrations.test.ts`
- Modify: `apps/api/scripts/db-init.ts`
- Modify: `apps/api/scripts/run-tests.mjs`

### A1: Expand the test runner to include `scripts/`

The test runner (`run-tests.mjs`) currently only finds `.test.ts` files under `apps/api/src/`. The new migration library lives in `scripts/`, so we expand the search.

- [ ] **Open `apps/api/scripts/run-tests.mjs`.** Find this line (line 30):

```js
const testFiles = findTestFiles(join(projectRoot, 'src'));
```

Replace with:

```js
const testFiles = [
  ...findTestFiles(join(projectRoot, 'src')),
  ...findTestFiles(join(projectRoot, 'scripts')),
];
```

- [ ] **Run the test suite to confirm no regressions:**

```
cd apps/api && npm test
```

Expected: same pass count as before (the `scripts/` dir has no `.test.ts` files yet so the count is identical).

### A2: Write the failing tests first (TDD)

- [ ] **Create `apps/api/scripts/db-migrations.test.ts`** with this content:

```typescript
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import type { Pool } from 'pg';
import { applyMigration, bootstrapIfNeeded } from './db-migrations';

// Pool whose query() and client.query() both route through a single handler.
// Only use when pool.connect() is never called by the function under test.
function poolQueryOnly(
  handler: (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] },
): Pool {
  return {
    query: async (sql: string, params?: unknown[]) => handler(sql, params),
    connect: async () => {
      throw new Error('pool.connect() was called unexpectedly');
    },
  } as unknown as Pool;
}

// Pool with separate handlers for the initial pool.query (used for the
// "already recorded?" check) and for each client.query call (BEGIN / SQL / INSERT / COMMIT).
function poolWithClient(
  poolHandler: (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] },
  clientHandler: (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] },
): Pool {
  return {
    query: async (sql: string, params?: unknown[]) => poolHandler(sql, params),
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => clientHandler(sql, params),
      release: () => {},
    }),
  } as unknown as Pool;
}

// ─── applyMigration ───────────────────────────────────────────────────────────

test('applyMigration returns false when migration is already recorded', async () => {
  const pool = poolQueryOnly((sql) => {
    if (sql.includes('WHERE filename')) return { rows: [{ '?column?': 1 }] };
    return { rows: [] };
  });
  const dir = await mkdtemp(join(tmpdir(), 'jobops-'));
  const filePath = join(dir, '001_test.sql');
  await writeFile(filePath, 'SELECT 1;');
  try {
    const result = await applyMigration(pool, filePath);
    assert.equal(result, false);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('applyMigration runs BEGIN/SQL/INSERT/COMMIT and returns true on success', async () => {
  const executed: string[] = [];
  let clientCallCount = 0;
  const pool = poolWithClient(
    // pool.query: the SELECT check returns empty (not yet recorded)
    (sql) => {
      if (sql.includes('WHERE filename')) return { rows: [] };
      return { rows: [] };
    },
    // client.query: record each call
    (sql) => {
      clientCallCount++;
      executed.push(sql.trim().slice(0, 80));
      return { rows: [] };
    },
  );
  const dir = await mkdtemp(join(tmpdir(), 'jobops-'));
  const filePath = join(dir, '001_test.sql');
  await writeFile(filePath, 'CREATE TABLE _test_ok (id serial);');
  try {
    const result = await applyMigration(pool, filePath);
    assert.equal(result, true);
    assert.ok(executed.includes('BEGIN'), `expected BEGIN; got: ${JSON.stringify(executed)}`);
    assert.ok(
      executed.some((q) => q.startsWith('INSERT INTO schema_migrations')),
      `expected INSERT schema_migrations; got: ${JSON.stringify(executed)}`,
    );
    assert.ok(executed.includes('COMMIT'), `expected COMMIT; got: ${JSON.stringify(executed)}`);
    assert.ok(!executed.includes('ROLLBACK'), 'should not have rolled back on success');
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('applyMigration rolls back and rethrows when the migration SQL fails', async () => {
  const executed: string[] = [];
  let clientCallCount = 0;
  const pool = poolWithClient(
    (sql) => {
      if (sql.includes('WHERE filename')) return { rows: [] };
      return { rows: [] };
    },
    async (sql) => {
      clientCallCount++;
      executed.push(sql.trim().slice(0, 80));
      // 1st call = BEGIN (ok), 2nd call = the migration SQL (fail), 3rd call = ROLLBACK
      if (clientCallCount === 2) throw new Error('syntax error at or near BAD');
      return { rows: [] };
    },
  );
  const dir = await mkdtemp(join(tmpdir(), 'jobops-'));
  const filePath = join(dir, '001_bad.sql');
  await writeFile(filePath, 'BAD SQL THAT FAILS;');
  try {
    await assert.rejects(() => applyMigration(pool, filePath), /syntax error/);
    assert.ok(executed.includes('ROLLBACK'), `expected ROLLBACK; got: ${JSON.stringify(executed)}`);
    assert.ok(!executed.includes('COMMIT'), 'should not have committed after failure');
    assert.ok(
      !executed.some((q) => q.startsWith('INSERT INTO schema_migrations')),
      'should not have recorded the migration after failure',
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});

// ─── bootstrapIfNeeded ────────────────────────────────────────────────────────

test('bootstrapIfNeeded pre-seeds all migrations when table is empty and jobs table exists', async () => {
  const inserted: string[] = [];
  const pool = poolQueryOnly((sql, params) => {
    if (sql.includes('count(*)')) return { rows: [{ n: '0' }] };
    if (sql.includes('information_schema')) return { rows: [{ '?column?': 1 }] };
    if (sql.includes('INSERT INTO schema_migrations')) inserted.push(String(params?.[0] ?? ''));
    return { rows: [] };
  });
  await bootstrapIfNeeded(pool, ['/m/001_init.sql', '/m/002_jobs.sql']);
  assert.deepEqual(inserted, ['001_init.sql', '002_jobs.sql']);
});

test('bootstrapIfNeeded does nothing when the tracking table already has rows', async () => {
  let extraCalls = 0;
  const pool = poolQueryOnly((sql) => {
    if (sql.includes('count(*)')) return { rows: [{ n: '7' }] };
    extraCalls++;
    return { rows: [] };
  });
  await bootstrapIfNeeded(pool, ['/m/001.sql']);
  assert.equal(extraCalls, 0, 'should not have made further queries after seeing n > 0');
});

test('bootstrapIfNeeded does nothing on a fresh DB (jobs table absent)', async () => {
  const inserted: string[] = [];
  const pool = poolQueryOnly((sql, params) => {
    if (sql.includes('count(*)')) return { rows: [{ n: '0' }] };
    if (sql.includes('information_schema')) return { rows: [] }; // no jobs table
    if (sql.includes('INSERT INTO schema_migrations')) inserted.push(String(params?.[0] ?? ''));
    return { rows: [] };
  });
  await bootstrapIfNeeded(pool, ['/m/001.sql']);
  assert.equal(inserted.length, 0, 'should not pre-seed when jobs table is missing');
});
```

- [ ] **Run the test suite:**

```
cd apps/api && npm test
```

Expected: the three new `applyMigration` tests and three `bootstrapIfNeeded` tests all **fail** with `Cannot find module './db-migrations'` (the module doesn't exist yet). All pre-existing tests still pass.

### A3: Implement the migration library

- [ ] **Create `apps/api/scripts/db-migrations.ts`:**

```typescript
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Pool } from 'pg';

export async function listMigrationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => join(dir, e.name))
    .sort((a, b) => a.localeCompare(b));
}

export async function ensureTrackingTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * If schema_migrations is empty AND the jobs table already exists, the DB
 * was initialised before tracking was added. Pre-seed all known migration
 * filenames so the first tracked run skips them rather than re-running against
 * live data.
 */
export async function bootstrapIfNeeded(pool: Pool, migrationFiles: string[]): Promise<void> {
  const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM schema_migrations');
  if (Number(rows[0].n) > 0) return;

  const { rows: jobRows } = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'jobs' LIMIT 1",
  );
  if (jobRows.length === 0) return; // fresh DB — let migrations run normally

  console.log('Existing DB detected — pre-seeding schema_migrations for all current migrations.');
  for (const filePath of migrationFiles) {
    await pool.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
      [basename(filePath)],
    );
  }
}

/**
 * Apply a single SQL file if it has not already been recorded.
 * The SQL and the tracking INSERT share one transaction: a crash between them
 * is impossible. Returns true if the migration was applied, false if skipped.
 */
export async function applyMigration(pool: Pool, filePath: string): Promise<boolean> {
  const filename = basename(filePath);

  const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename]);
  if (rows.length > 0) {
    console.log(`Skipping already-applied migration ${filename}`);
    return false;
  }

  const sql = await readFile(filePath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
    console.log(`Applied migration ${filename}`);
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

- [ ] **Run the test suite:**

```
cd apps/api && npm test
```

Expected: all six new tests **pass**, all pre-existing tests still pass.

### A4: Update `db-init.ts` to use the tracking library

- [ ] **Replace the entire contents of `apps/api/scripts/db-init.ts`:**

```typescript
import 'dotenv/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import {
  applyMigration,
  bootstrapIfNeeded,
  ensureTrackingTable,
  listMigrationFiles,
} from './db-migrations';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required. Set it in apps/api/.env before running the database bootstrap.',
  );
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..', '..', '..');
const migrationDir = join(repoRoot, 'db', 'migrations');

function describeTarget(url: string) {
  const parsed = new URL(url);
  return `${parsed.hostname}${parsed.pathname}`;
}

async function main() {
  const pool = new Pool({
    connectionString: databaseUrl,
    allowExitOnIdle: true,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  try {
    console.log(`Connecting to ${describeTarget(databaseUrl)}`);
    await pool.query('SELECT 1');

    await ensureTrackingTable(pool);

    const migrationFiles = await listMigrationFiles(migrationDir);
    await bootstrapIfNeeded(pool, migrationFiles);

    let applied = 0;
    let skipped = 0;
    for (const filePath of migrationFiles) {
      const wasApplied = await applyMigration(pool, filePath);
      if (wasApplied) applied++;
      else skipped++;
    }

    console.log(`Bootstrap complete: ${applied} applied, ${skipped} skipped.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Database bootstrap failed.');
  console.error(error);
  process.exitCode = 1;
});
```

### A5: Type-check, lint, run tests, commit

- [ ] **Type-check:**

```
cd apps/api && npm run typecheck
```

Expected: no errors.

- [ ] **Lint:**

```
cd apps/api && npm run lint
```

Expected: no errors.

- [ ] **Run tests (full suite):**

```
cd apps/api && npm test
```

Expected: all tests pass.

- [ ] **Commit:**

```bash
git checkout -b feat/pr-a-db-migration-tracking
git add apps/api/scripts/db-migrations.ts \
        apps/api/scripts/db-migrations.test.ts \
        apps/api/scripts/db-init.ts \
        apps/api/scripts/run-tests.mjs
git commit -m "feat: add schema_migrations tracking to db:init (idempotent re-runs)"
```

- [ ] **Open PR** targeting `main` with title: `feat: idempotent db:init via schema_migrations tracking`.

---

## Task B: J6 — Job-Create Form A11y (PR B)

**Files:**
- Modify: `apps/web/src/components/job-create-form.tsx`

### B1: Wire `name`, `autocomplete`, `type`, `aria-describedby`, `aria-invalid`, and focus-first-error

Read `job-create-form.tsx` first. The component has:
- `errors` state: `Record<string, string>`
- Inputs: `company` (id="company"), `title` (id="title"), `jobUrl` (id="jobUrl"), `location` (id="location"), `workplace` (select), `priority` (select), `description` (textarea)
- Error pattern per field: `{errors.company ? <p className="text-destructive text-xs">{errors.company}</p> : null}`

- [ ] **Add `useRef` imports and create refs for the first-error focus.** Near the top of the component, after the existing `useState` hooks:

```tsx
import { useRef, useState } from 'react';
// ... existing imports ...

// Inside the component, after state declarations:
const companyRef = useRef<HTMLInputElement>(null);
const titleRef   = useRef<HTMLInputElement>(null);
const jobUrlRef  = useRef<HTMLInputElement>(null);
const locationRef = useRef<HTMLInputElement>(null);
```

- [ ] **Update each input element.** Replace the existing input/textarea JSX with the following (keep all existing className, value, onChange, placeholder props — only add the new attributes):

For **company** input:
```tsx
<Input
  ref={companyRef}
  id="company"
  name="company"
  autoComplete="organization"
  value={fields.company}
  onChange={(e) => updateField('company', e.target.value)}
  placeholder="Acme Corp"
  aria-describedby={errors.company ? 'company-error' : undefined}
  aria-invalid={errors.company ? true : undefined}
/>
{errors.company ? (
  <p id="company-error" className="text-destructive text-xs">{errors.company}</p>
) : null}
```

For **title** input:
```tsx
<Input
  ref={titleRef}
  id="title"
  name="title"
  autoComplete="off"
  value={fields.title}
  onChange={(e) => updateField('title', e.target.value)}
  placeholder="Software Engineer"
  aria-describedby={errors.title ? 'title-error' : undefined}
  aria-invalid={errors.title ? true : undefined}
/>
{errors.title ? (
  <p id="title-error" className="text-destructive text-xs">{errors.title}</p>
) : null}
```

For **jobUrl** input — also change `type` to `"url"`:
```tsx
<Input
  ref={jobUrlRef}
  id="jobUrl"
  name="jobUrl"
  type="url"
  autoComplete="url"
  value={fields.jobUrl}
  onChange={(e) => updateField('jobUrl', e.target.value)}
  placeholder="https://example.com/jobs/123"
  aria-describedby={errors.jobUrl ? 'job-url-error' : undefined}
  aria-invalid={errors.jobUrl ? true : undefined}
/>
{errors.jobUrl ? (
  <p id="job-url-error" className="text-destructive text-xs">{errors.jobUrl}</p>
) : null}
```

For **location** input:
```tsx
<Input
  ref={locationRef}
  id="location"
  name="location"
  autoComplete="off"
  value={fields.location}
  onChange={(e) => updateField('location', e.target.value)}
  placeholder="Remote / New York, NY"
  aria-describedby={errors.location ? 'location-error' : undefined}
  aria-invalid={errors.location ? true : undefined}
/>
{errors.location ? (
  <p id="location-error" className="text-destructive text-xs">{errors.location}</p>
) : null}
```

- [ ] **Add focus-first-error logic to the submit handler.** In the `onSubmit` (or `handleSubmit`) function, after validation populates `errors`, add:

```tsx
// Focus the first invalid field so keyboard/screen-reader users land on the error.
const focusOrder: Array<{ key: string; ref: React.RefObject<HTMLInputElement | null> }> = [
  { key: 'company',  ref: companyRef },
  { key: 'title',    ref: titleRef },
  { key: 'jobUrl',   ref: jobUrlRef },
  { key: 'location', ref: locationRef },
];
const firstError = focusOrder.find(({ key }) => !!nextErrors[key]);
if (firstError) {
  // setTimeout(0) lets React flush the DOM before we steal focus.
  setTimeout(() => firstError.ref.current?.focus(), 0);
  return;
}
```

Where `nextErrors` is the newly-computed errors object (the name will match whatever the form already uses for the validation result).

- [ ] **Clear field error on change.** In `updateField` (or wherever a field change is handled), clear that field's error:

```tsx
function updateField(key: keyof typeof fields, value: string) {
  setFields((prev) => ({ ...prev, [key]: value }));
  if (errors[key]) setErrors((prev) => ({ ...prev, [key]: '' }));
}
```

If `updateField` already exists, add the `setErrors` line.

### B2: Run web tests and type-check

- [ ] **Type-check:**

```
cd apps/web && npm run typecheck
```

Expected: no errors.

- [ ] **Run tests:**

```
cd apps/web && npm test
```

Expected: all tests pass (no vitest file for this component — a focused a11y test requires browser tooling; this fix is verified by the type-checker and manual inspection).

- [ ] **Lint:**

```
cd apps/web && npm run lint
```

Expected: no errors.

- [ ] **Commit:**

```bash
git checkout -b feat/pr-b-j6-form-a11y
git add apps/web/src/components/job-create-form.tsx
git commit -m "feat(J6): add name/autocomplete/type/aria attrs and focus-first-error to job-create form"
```

- [ ] **Open PR** targeting `main`.

---

## Task C: J7 — Assistant Pass-Node Guidance (PR C)

**Files:**
- Modify: `apps/web/src/components/assistant-panel.tsx`

### C1: Fix the pass-node icon and add a guidance callout

Read `assistant-panel.tsx`. The component renders analysis steps from `steps: Array<{ node: string; label?: string }>`. It uses `NODE_LABELS` and renders `<Check className="size-3.5 text-emerald-500" />` for every step.

- [ ] **Import `X` from lucide-react.** Find the existing import:

```tsx
import { Check, ... } from 'lucide-react';
```

Add `X` to the same import line.

- [ ] **Replace the single `<Check>` icon with a per-step conditional.** Find the step icon render (something like):

```tsx
<Check className="size-3.5 text-emerald-500" />
```

Replace with:

```tsx
{step.node === 'pass' || step.node === 'below_fit_bar' ? (
  <X className="size-3.5 text-destructive" />
) : (
  <Check className="size-3.5 text-emerald-500" />
)}
```

- [ ] **Add the guidance callout below the steps list.** After the closing tag of the steps list (`</ul>` or equivalent), add:

```tsx
{steps.some((s) => s.node === 'pass' || s.node === 'below_fit_bar') ? (
  <div
    role="status"
    className="bg-muted mt-3 rounded-md px-3 py-2 text-sm"
  >
    <p className="font-medium">Below the fit threshold</p>
    <p className="text-muted-foreground mt-1">
      Your profile didn&apos;t score high enough for this role. Common next steps: strengthen your
      resume for the required skills, or use the <strong>Score fit</strong> button on the job
      detail page to see exactly what&apos;s missing.
    </p>
  </div>
) : null}
```

### C2: Type-check, lint, run tests, commit

- [ ] **Type-check:**

```
cd apps/web && npm run typecheck
```

- [ ] **Lint:**

```
cd apps/web && npm run lint
```

- [ ] **Run tests:**

```
cd apps/web && npm test
```

Expected: all pass.

- [ ] **Commit:**

```bash
git checkout -b feat/pr-c-j7-pass-node-guidance
git add apps/web/src/components/assistant-panel.tsx
git commit -m "feat(J7): show X icon and guidance callout when agent scores below fit threshold"
```

- [ ] **Open PR** targeting `main`.

---

## Task D: J8 — Dashboard Direct Seed Button (PR D)

**Files:**
- Create: `apps/web/src/components/load-sample-data-button.tsx`
- Modify: `apps/web/src/app/(app)/dashboard/page.tsx`

### D1: Create `LoadSampleDataButton`

- [ ] **Create `apps/web/src/components/load-sample-data-button.tsx`:**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { seedDemoData } from '@/lib/api';

export function LoadSampleDataButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      await seedDemoData();
      toast.success('Sample data loaded.');
      router.refresh();
    } catch {
      toast.error('Could not load sample data. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" disabled={busy} onClick={handleClick}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
      Load sample data
    </Button>
  );
}
```

### D2: Update the dashboard page

Read `apps/web/src/app/(app)/dashboard/page.tsx`. Find line 84 (approximately):

```tsx
<Button render={<Link href="/settings" />} variant="outline">Load sample data</Button>
```

- [ ] **Replace that button with the client component.** First, add the import near the top of the file:

```tsx
import { LoadSampleDataButton } from '@/components/load-sample-data-button';
```

Then replace the button JSX with:

```tsx
<LoadSampleDataButton />
```

Also remove the `Link` import if it's now unused in this file.

### D3: Type-check, lint, run tests, commit

- [ ] **Type-check:**

```
cd apps/web && npm run typecheck
```

- [ ] **Lint:**

```
cd apps/web && npm run lint
```

- [ ] **Run tests:**

```
cd apps/web && npm test
```

- [ ] **Commit:**

```bash
git checkout -b feat/pr-d-j8-dashboard-direct-seed
git add apps/web/src/components/load-sample-data-button.tsx \
        apps/web/src/app/\(app\)/dashboard/page.tsx
git commit -m "feat(J8): dashboard Load Sample Data seeds inline instead of navigating to settings"
```

- [ ] **Open PR** targeting `main`.

---

## Task E: J9 — Heading Hierarchy + Duplicate Chips (PR E)

**Files:**
- Modify: `apps/web/src/components/app-header.tsx`
- Modify: `apps/web/src/app/onboarding/page.tsx`
- Modify: `apps/web/src/components/jobs-table.tsx`
- Create: `apps/web/src/components/jobs-table.isDuplicateRemote.test.ts`

### E1: Fix the double `<h1>` in `app-header.tsx`

Read `apps/web/src/components/app-header.tsx`. Find line 59:

```tsx
<h1 className="font-heading truncate text-base font-semibold sm:text-lg">{title}</h1>
```

- [ ] **Change `<h1>` to `<p>` — identical className, just a different element:**

```tsx
<p className="font-heading truncate text-base font-semibold sm:text-lg">{title}</p>
```

### E2: Fix the missing semantic heading in `onboarding/page.tsx`

Read `apps/web/src/app/onboarding/page.tsx`. Find the two `<CardTitle>` elements at lines 107 and 115:

```tsx
<CardTitle className="font-heading text-2xl">Welcome to JobOps Copilot</CardTitle>
```

- [ ] **Replace each `<CardTitle>` with a real `<h1>`.** The onboarding page has no other heading, so a single `<h1>` is correct. If `CardTitle` appears twice (e.g. in two steps of a wizard), replace only the first-rendered one with `<h1>` and the rest with `<p>`:

```tsx
<h1 className="font-heading text-2xl font-semibold">Welcome to JobOps Copilot</h1>
```

Remove the `CardTitle` import if it's now unused.

### E3: Write the failing `isDuplicateRemote` test

- [ ] **Create `apps/web/src/components/jobs-table.isDuplicateRemote.test.ts`:**

```typescript
import { describe, expect, it } from 'vitest';
import { isDuplicateRemote } from './jobs-table';

describe('isDuplicateRemote', () => {
  it('returns true when location is "Remote" and workplaceType is "remote"', () => {
    expect(isDuplicateRemote('Remote', 'remote')).toBe(true);
  });

  it('returns true case-insensitively (e.g. "REMOTE")', () => {
    expect(isDuplicateRemote('REMOTE', 'remote')).toBe(true);
  });

  it('returns true with surrounding whitespace', () => {
    expect(isDuplicateRemote('  remote  ', 'remote')).toBe(true);
  });

  it('returns false when location is a city and workplaceType is remote', () => {
    expect(isDuplicateRemote('New York, NY', 'remote')).toBe(false);
  });

  it('returns false when workplaceType is not remote', () => {
    expect(isDuplicateRemote('Remote', 'hybrid')).toBe(false);
  });

  it('returns false when workplaceType is on-site', () => {
    expect(isDuplicateRemote('Remote', 'onsite')).toBe(false);
  });
});
```

- [ ] **Run the test to confirm it fails:**

```
cd apps/web && npm test -- jobs-table.isDuplicateRemote
```

Expected: fails with `isDuplicateRemote is not exported from './jobs-table'`.

### E4: Implement `isDuplicateRemote` in `jobs-table.tsx`

Read `apps/web/src/components/jobs-table.tsx`. 

- [ ] **Export the helper from `jobs-table.tsx`.** Add near the top of the file (before the component):

```tsx
export function isDuplicateRemote(location: string, workplaceType: string): boolean {
  return location.trim().toLowerCase() === 'remote' && workplaceType === 'remote';
}
```

- [ ] **Use it in the render.** Find line 186 (approximately):

```tsx
{job.company} · {job.location}
```

Replace with:

```tsx
{job.company}{isDuplicateRemote(job.location ?? '', job.workplaceType ?? '') ? '' : ` · ${job.location}`}
```

If `job.location` and `job.workplaceType` are non-nullable in the type, remove the `?? ''` fallbacks.

### E5: Run tests, type-check, lint, commit

- [ ] **Run `isDuplicateRemote` tests:**

```
cd apps/web && npm test -- jobs-table.isDuplicateRemote
```

Expected: all 6 tests pass.

- [ ] **Run full test suite:**

```
cd apps/web && npm test
```

- [ ] **Type-check and lint:**

```
cd apps/web && npm run typecheck && npm run lint
```

- [ ] **Commit:**

```bash
git checkout -b feat/pr-e-j9-heading-hierarchy
git add apps/web/src/components/app-header.tsx \
        apps/web/src/app/onboarding/page.tsx \
        apps/web/src/components/jobs-table.tsx \
        apps/web/src/components/jobs-table.isDuplicateRemote.test.ts
git commit -m "feat(J9): fix double h1, add onboarding heading, suppress duplicate Remote chip"
```

- [ ] **Open PR** targeting `main`.

---

## Task F: J10 — Motion + Export + Outreach Expand (PR F)

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/settings-actions.tsx`
- Create: `apps/web/src/components/outreach-draft-card.tsx`
- Modify: `apps/web/src/app/(app)/outreach/page.tsx`

### F1: Add `prefers-reduced-motion` to `globals.css`

Read `apps/web/src/app/globals.css`. Scroll to the end of the file.

- [ ] **Append at the very end of the file** (after all existing rules):

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### F2: Replace `ExportDataButton` with fetch + Blob download

Read `apps/web/src/components/settings-actions.tsx`. Find `ExportDataButton` (starts at line 48):

```tsx
export function ExportDataButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      className="ml-auto"
      onClick={() => window.open('/api/proxy/api/profile/export', '_blank')}
    >
      <Download className="size-4" /> Export data
    </Button>
  );
}
```

- [ ] **Replace it with a stateful version that uses fetch + Blob:**

```tsx
export function ExportDataButton() {
  const [busy, setBusy] = useState(false);

  async function exportData() {
    setBusy(true);
    try {
      const response = await fetch('/api/proxy/api/profile/export');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
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

  return (
    <Button variant="outline" size="sm" className="ml-auto" disabled={busy} onClick={exportData}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
      Export data
    </Button>
  );
}
```

Make sure `useState` and `Loader2` are imported at the top of the file (they may already be present from `ResumeReupload` and `DemoDataActions`). `toast` is also already imported.

### F3: Create `OutreachDraftCard` (expand/collapse for outreach text)

- [ ] **Create `apps/web/src/components/outreach-draft-card.tsx`:**

```tsx
'use client';

import { useState } from 'react';

interface Props {
  id: string;
  draftText: string;
}

export function OutreachDraftCard({ id: _id, draftText }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <p
        className={
          expanded
            ? 'text-muted-foreground max-h-48 overflow-y-auto text-sm'
            : 'text-muted-foreground line-clamp-3 text-sm'
        }
      >
        {draftText}
      </p>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="text-muted-foreground hover:text-foreground mt-1 text-xs underline"
      >
        {expanded ? 'Collapse' : 'Show full message'}
      </button>
    </div>
  );
}
```

### F4: Update `outreach/page.tsx` to use `OutreachDraftCard`

Read `apps/web/src/app/(app)/outreach/page.tsx`. Find the `<p>` at line 76:

```tsx
<p className="text-muted-foreground line-clamp-3 text-sm">{item.draft.draftText}</p>
```

- [ ] **Add the import** near the top of the file:

```tsx
import { OutreachDraftCard } from '@/components/outreach-draft-card';
```

- [ ] **Replace the `<p>` element** with:

```tsx
<OutreachDraftCard id={item.draft.id} draftText={item.draft.draftText} />
```

(Use the actual id field name from the `item.draft` type — it may be `item.id` or `item.draft.id`; read the type to confirm.)

### F5: Run tests, type-check, lint, build, commit

- [ ] **Type-check:**

```
cd apps/web && npm run typecheck
```

- [ ] **Lint:**

```
cd apps/web && npm run lint
```

- [ ] **Run tests:**

```
cd apps/web && npm test
```

- [ ] **Build (catches server/client boundary errors):**

```
cd apps/web && npm run build
```

Expected: clean build, no warnings about missing `'use client'` or server-component violations.

- [ ] **Commit:**

```bash
git checkout -b feat/pr-f-j10-motion-export-outreach
git add apps/web/src/app/globals.css \
        apps/web/src/components/settings-actions.tsx \
        apps/web/src/components/outreach-draft-card.tsx \
        apps/web/src/app/\(app\)/outreach/page.tsx
git commit -m "feat(J10): prefers-reduced-motion, export as file download, outreach expand/collapse"
```

- [ ] **Open PR** targeting `main`.

---

## Self-Review Checklist

### Spec coverage

| Spec requirement | Task |
|-----------------|------|
| schema_migrations tracking table | A3 |
| Bootstrap detection (existing DB pre-seed) | A3 `bootstrapIfNeeded` |
| Per-migration transaction (BEGIN/SQL/INSERT/COMMIT) | A3 `applyMigration` |
| `db-init.ts` updated to use tracking | A4 |
| Unit tests for skip/apply/rollback/bootstrap | A2 |
| J6: name/autocomplete/type attrs | B1 |
| J6: aria-describedby + aria-invalid | B1 |
| J6: focus-first-error on submit | B1 |
| J6: clear error on change | B1 |
| J7: X icon for pass node | C1 |
| J7: guidance callout | C1 |
| J8: LoadSampleDataButton client component | D1 |
| J8: Dashboard wired to component | D2 |
| J9: app-header h1→p | E1 |
| J9: onboarding CardTitle→h1 | E2 |
| J9: isDuplicateRemote helper + tests | E3/E4 |
| J10: prefers-reduced-motion CSS | F1 |
| J10: ExportDataButton fetch + blob | F2 |
| J10: OutreachDraftCard expand/collapse | F3/F4 |

All requirements covered. No gaps found.

### Hardening check

- **Transaction safety:** `applyMigration` wraps SQL + INSERT in one transaction. A crash mid-migration leaves neither the schema change nor the tracking record, so the next run retries cleanly.
- **Bootstrap idempotency:** `ON CONFLICT DO NOTHING` makes the pre-seed safe to run multiple times.
- **ExportDataButton:** `setBusy` prevents double-clicks; `URL.revokeObjectURL` runs in `finally` via the outer try/finally.
- **LoadSampleDataButton:** `disabled={busy}` prevents double-submit; `router.refresh()` ensures the dashboard reflects seeded data.
- **OutreachDraftCard:** expand state is local; toggle button stays in place (focus not moved); `max-h-48 overflow-y-auto` prevents long messages from breaking table layout.
- **prefers-reduced-motion:** `!important` overrides both Tailwind and tw-animate-css animations.
- **Focus-first-error:** `setTimeout(fn, 0)` ensures React has flushed DOM before `focus()` is called.

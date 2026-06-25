# Agent Output Persistence — PR A (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Persist interview-prep / research / skill-gap agent outputs per `(job, kind)` and expose them via `GET /api/jobs/:id/agent-outputs`, so runs survive reloads/logout and re-running is deliberate.

**Architecture:** A migration adds `agent_outputs` (unique on `(job_id, kind)`). A dual file/Postgres `agent-output-store` upserts + lists by user. The 3 agent endpoints best-effort-persist on a successful run via a tiny `persistAgentRun` helper. A thin injectable router serves the read endpoint (ownership-guarded), mounted at `/api/jobs`.

**Tech Stack:** Postgres (pg), Express, node:test + tsx. Spec: `docs/superpowers/specs/2026-06-24-agent-output-persistence-design.md`.

**Branch:** `feat/agent-output-persistence` (already created; carries the spec). **Scope:** PR A of 2 (B = frontend).

**Ownership note:** the agent endpoints already 404 via `getJobById(userId, jobId)` before running, and the read endpoint does the same — so route handlers are the ownership gate. The store scopes/stamps `userId`; Postgres adds a defensive `where exists` clause too.

---

## File structure
- **Create** `db/migrations/008_agent_outputs.sql` — the table.
- **Create** `apps/api/src/data/agent-output-store.ts` — file-mode store + `saveAgentOutput`/`listAgentOutputs`/`persistAgentRun`/`resetAgentOutputStoreForTests`, delegating to Postgres when configured.
- **Create** `apps/api/src/data/agent-output-store.postgres.ts` — Postgres upsert + list.
- **Create** `apps/api/src/data/agent-output-store.test.ts` — file-mode tests.
- **Create** `apps/api/src/data/agent-output-persist.test.ts` — `persistAgentRun` tests.
- **Modify** `apps/api/src/routes/ai.ts` — call `persistAgentRun` in the 3 agent handlers.
- **Create** `apps/api/src/routes/agent-outputs.ts` — `createAgentOutputsRouter`.
- **Create** `apps/api/src/routes/agent-outputs.test.ts` — route tests.
- **Modify** `apps/api/src/app.ts` — mount the router.

---

## Task 1: Migration + store

**Files:**
- Create: `db/migrations/008_agent_outputs.sql`
- Create: `apps/api/src/data/agent-output-store.postgres.ts`
- Create: `apps/api/src/data/agent-output-store.ts`
- Test: `apps/api/src/data/agent-output-store.test.ts`

- [ ] **Step 1: Write the migration**

Create `db/migrations/008_agent_outputs.sql`:

```sql
-- Persisted AI agent outputs (interview prep / research / skill gap) per job.
-- One current output per (job, kind); regenerate upserts it.
create table if not exists agent_outputs (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  user_id text not null,
  kind text not null check (kind in ('interview_prep', 'research', 'skill_gap')),
  payload jsonb not null,
  model_used text,
  created_at timestamptz not null default now(),
  unique (job_id, kind)
);

create index if not exists agent_outputs_job_idx on agent_outputs (job_id);
create index if not exists agent_outputs_user_idx on agent_outputs (user_id);
```

- [ ] **Step 2: Write the Postgres store**

Create `apps/api/src/data/agent-output-store.postgres.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { getPool } from '@/lib/postgres';

export type AgentKind = 'interview_prep' | 'research' | 'skill_gap';

export interface AgentOutputRecord {
  jobId: string;
  kind: AgentKind;
  payload: unknown;
  modelUsed?: string;
  createdAt: string;
}

type AgentOutputRow = {
  job_id: string;
  kind: string;
  payload: unknown;
  model_used: string | null;
  created_at: string;
};

function poolOrThrow() {
  const pool = getPool();
  if (!pool) {
    throw new Error('Postgres is not configured. Set DATABASE_URL to enable the database-backed store.');
  }
  return pool;
}

function mapRow(row: AgentOutputRow): AgentOutputRecord {
  return {
    jobId: row.job_id,
    kind: row.kind as AgentKind,
    payload: row.payload,
    modelUsed: row.model_used ?? undefined,
    createdAt: row.created_at,
  };
}

export async function saveAgentOutput(
  userId: string,
  jobId: string,
  kind: AgentKind,
  payload: unknown,
  modelUsed?: string,
): Promise<AgentOutputRecord | undefined> {
  const pool = poolOrThrow();
  // The `where exists` makes a non-owner insert affect 0 rows (defense in depth;
  // the route already 404s for unowned jobs).
  const { rows } = await pool.query<AgentOutputRow>(
    `
      insert into agent_outputs (id, job_id, user_id, kind, payload, model_used, created_at)
      select $1, $2, $3, $4, $5::jsonb, $6, now()
      where exists (select 1 from jobs where id::text = $2 and user_id = $3)
      on conflict (job_id, kind) do update set
        payload = excluded.payload,
        model_used = excluded.model_used,
        created_at = now()
      returning *
    `,
    [randomUUID(), jobId, userId, kind, JSON.stringify(payload), modelUsed ?? null],
  );
  const saved = rows[0];
  return saved ? mapRow(saved) : undefined;
}

export async function listAgentOutputs(userId: string, jobId: string): Promise<AgentOutputRecord[]> {
  const pool = poolOrThrow();
  const { rows } = await pool.query<AgentOutputRow>(
    'select * from agent_outputs where job_id::text = $1 and user_id = $2 order by created_at desc',
    [jobId, userId],
  );
  return rows.map(mapRow);
}
```

- [ ] **Step 3: Write the failing store test**

Create `apps/api/src/data/agent-output-store.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listAgentOutputs,
  resetAgentOutputStoreForTests,
  saveAgentOutput,
} from './agent-output-store';

async function withTempStore(run: () => Promise<void>) {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL; // force the file store
  const dir = await mkdtemp(join(tmpdir(), 'jobops-agent-outputs-'));
  try {
    process.chdir(dir);
    resetAgentOutputStoreForTests();
    await run();
  } finally {
    process.chdir(originalCwd);
    resetAgentOutputStoreForTests();
    await rm(dir, { recursive: true, force: true });
  }
}

test('saveAgentOutput upserts one row per (job, kind)', async () => {
  await withTempStore(async () => {
    await saveAgentOutput('u1', 'job-1', 'interview_prep', { v: 1 }, 'model-a');
    await saveAgentOutput('u1', 'job-1', 'interview_prep', { v: 2 }, 'model-b');

    const outputs = await listAgentOutputs('u1', 'job-1');
    assert.equal(outputs.length, 1);
    assert.deepEqual(outputs[0]?.payload, { v: 2 });
    assert.equal(outputs[0]?.modelUsed, 'model-b');
    assert.equal(outputs[0]?.kind, 'interview_prep');
  });
});

test('listAgentOutputs returns all kinds for a job, scoped to the user', async () => {
  await withTempStore(async () => {
    await saveAgentOutput('u1', 'job-1', 'interview_prep', { a: 1 });
    await saveAgentOutput('u1', 'job-1', 'research', { b: 2 });
    await saveAgentOutput('u2', 'job-1', 'skill_gap', { c: 3 }); // other user, same job

    const mine = await listAgentOutputs('u1', 'job-1');
    assert.deepEqual(mine.map((o) => o.kind).sort(), ['interview_prep', 'research']);

    const other = await listAgentOutputs('u2', 'job-1');
    assert.deepEqual(other.map((o) => o.kind), ['skill_gap']);
  });
});

test('listAgentOutputs is empty for a job with no outputs', async () => {
  await withTempStore(async () => {
    assert.deepEqual(await listAgentOutputs('u1', 'job-x'), []);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node --import tsx --test --test-concurrency=1 src/data/agent-output-store.test.ts`
Expected: FAIL — `./agent-output-store` not found.

- [ ] **Step 5: Write the file-mode store**

Create `apps/api/src/data/agent-output-store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hasPostgresConnection } from '@/lib/postgres';
import * as postgresStore from '@/data/agent-output-store.postgres';
import type { AgentKind, AgentOutputRecord } from '@/data/agent-output-store.postgres';

export type { AgentKind, AgentOutputRecord } from '@/data/agent-output-store.postgres';

interface StoredAgentOutput extends AgentOutputRecord {
  id: string;
  userId: string;
}

let cache: StoredAgentOutput[] | null = null;
let loadPromise: Promise<StoredAgentOutput[]> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function dataDir() {
  return join(process.cwd(), 'data');
}

function dataFile() {
  return join(dataDir(), 'agent-outputs.json');
}

async function load(): Promise<StoredAgentOutput[]> {
  await mkdir(dataDir(), { recursive: true });
  try {
    const raw = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid agent-output store contents');
    }
    cache = parsed as StoredAgentOutput[];
  } catch {
    cache = [];
    await persist();
  }
  return cache;
}

async function ensureLoaded(): Promise<StoredAgentOutput[]> {
  if (cache) return cache;
  loadPromise ??= load();
  return loadPromise;
}

async function persist() {
  if (!cache) return;
  await mkdir(dataDir(), { recursive: true });
  await writeFile(dataFile(), `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const previous = mutationQueue;
  let release!: () => void;
  mutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function toPublic(record: StoredAgentOutput): AgentOutputRecord {
  return {
    jobId: record.jobId,
    kind: record.kind,
    payload: record.payload,
    modelUsed: record.modelUsed,
    createdAt: record.createdAt,
  };
}

export async function saveAgentOutput(
  userId: string,
  jobId: string,
  kind: AgentKind,
  payload: unknown,
  modelUsed?: string,
): Promise<AgentOutputRecord | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.saveAgentOutput(userId, jobId, kind, payload, modelUsed);
  }
  return runExclusive(async () => {
    const list = await ensureLoaded();
    const index = list.findIndex((entry) => entry.jobId === jobId && entry.kind === kind);
    const record: StoredAgentOutput = {
      id: index >= 0 ? list[index]!.id : randomUUID(),
      userId,
      jobId,
      kind,
      payload: clone(payload),
      modelUsed,
      createdAt: new Date().toISOString(),
    };
    if (index >= 0) list[index] = record;
    else list.push(record);
    await persist();
    return toPublic(record);
  });
}

export async function listAgentOutputs(userId: string, jobId: string): Promise<AgentOutputRecord[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listAgentOutputs(userId, jobId);
  }
  const list = await ensureLoaded();
  return list
    .filter((entry) => entry.userId === userId && entry.jobId === jobId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((entry) => toPublic(clone(entry)));
}

export function resetAgentOutputStoreForTests() {
  cache = null;
  loadPromise = null;
  mutationQueue = Promise.resolve();
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node --import tsx --test --test-concurrency=1 src/data/agent-output-store.test.ts`
Expected: PASS (3 tests).

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot" && git add db/migrations/008_agent_outputs.sql apps/api/src/data/agent-output-store.ts apps/api/src/data/agent-output-store.postgres.ts apps/api/src/data/agent-output-store.test.ts && git commit -F - <<'EOF'
feat(api): agent_outputs table + dual-mode store (#121)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YY7NVS3QLuFeTqkmBaidAB
EOF
```

---

## Task 2: `persistAgentRun` helper + wire into the agent endpoints

**Files:**
- Modify: `apps/api/src/data/agent-output-store.ts`
- Create: `apps/api/src/data/agent-output-persist.test.ts`
- Modify: `apps/api/src/routes/ai.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/data/agent-output-persist.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { persistAgentRun } from './agent-output-store';

test('persistAgentRun saves with the model from the result', async () => {
  const calls: Array<{ userId: string; jobId: string; kind: string; payload: unknown; modelUsed?: string }> = [];
  const save = async (userId: string, jobId: string, kind: string, payload: unknown, modelUsed?: string) => {
    calls.push({ userId, jobId, kind, payload, modelUsed });
    return undefined;
  };

  await persistAgentRun('u1', 'job-1', 'research', { company_summary: 'x', model_used: 'gpt-z' }, save);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.kind, 'research');
  assert.equal(calls[0]?.modelUsed, 'gpt-z');
  assert.deepEqual(calls[0]?.payload, { company_summary: 'x', model_used: 'gpt-z' });
});

test('persistAgentRun swallows save failures (best-effort)', async () => {
  const save = async () => {
    throw new Error('db down');
  };
  // Must not reject.
  await persistAgentRun('u1', 'job-1', 'interview_prep', { likely_questions: [] }, save);
  assert.ok(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node --import tsx --test --test-concurrency=1 src/data/agent-output-persist.test.ts`
Expected: FAIL — `persistAgentRun` is not exported.

- [ ] **Step 3: Implement `persistAgentRun`**

Append to `apps/api/src/data/agent-output-store.ts`:

```ts
/**
 * Best-effort persistence for a successful agent run: stores the output and
 * NEVER throws (a save failure must not break the user's result). `save` is
 * injectable for tests.
 */
export async function persistAgentRun(
  userId: string,
  jobId: string,
  kind: AgentKind,
  result: unknown,
  save: typeof saveAgentOutput = saveAgentOutput,
): Promise<void> {
  try {
    const candidate = (result as { model_used?: unknown }).model_used;
    const modelUsed = typeof candidate === 'string' ? candidate : undefined;
    await save(userId, jobId, kind, result, modelUsed);
  } catch (error) {
    console.error('[agents] failed to persist output', error);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node --import tsx --test --test-concurrency=1 src/data/agent-output-persist.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into the 3 agent handlers**

In `apps/api/src/routes/ai.ts`:

Add to the imports (next to the other `@/data/...` imports):
```ts
import { persistAgentRun } from '@/data/agent-output-store';
```

In the **interview-prep** handler, replace:
```ts
    return response.json(result);
```
(the one right after `const result = await runAgentTask('/agents/interview-prep', { ... });`) with:
```ts
    await persistAgentRun(userId, body.job_id, 'interview_prep', result);
    return response.json(result);
```

In the **research** handler, replace its `return response.json(result);` (after `runAgentTask('/agents/research', …)`) with:
```ts
    await persistAgentRun(userId, body.job_id, 'research', result);
    return response.json(result);
```

In the **skill-gap** handler, replace its `return response.json(result);` (after `runAgentTask('/agents/skill-gap', …)`) with:
```ts
    await persistAgentRun(userId, body.job_id, 'skill_gap', result);
    return response.json(result);
```

(Each handler validated `body.job_id` is present earlier, so it is a string here.)

- [ ] **Step 6: Typecheck + the full API suite still passes**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && npm run typecheck && npm run lint`
Expected: no errors.

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node --import tsx --test --test-concurrency=1 src/data/agent-output-persist.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot" && git add apps/api/src/data/agent-output-store.ts apps/api/src/data/agent-output-persist.test.ts apps/api/src/routes/ai.ts && git commit -F - <<'EOF'
feat(api): persist agent outputs on a successful run (#121)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YY7NVS3QLuFeTqkmBaidAB
EOF
```

---

## Task 3: Read endpoint + mount + verification + PR

**Files:**
- Create: `apps/api/src/routes/agent-outputs.ts`
- Create: `apps/api/src/routes/agent-outputs.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write the failing route test**

Create `apps/api/src/routes/agent-outputs.test.ts`:

```ts
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createAgentOutputsRouter } from './agent-outputs';
import type { AgentOutputRecord } from '@/data/agent-output-store';
import type { JobRecord } from '@/types';

async function withServer(
  mount: (app: express.Express) => void,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    const header = request.header('X-User-Id');
    if (header) request.userId = header.trim();
    next();
  });
  mount(app);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('no server address');
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const fakeJob = { id: 'job-1' } as unknown as JobRecord;
const sampleOutputs: AgentOutputRecord[] = [
  { jobId: 'job-1', kind: 'research', payload: { company_summary: 'x' }, modelUsed: 'm', createdAt: '2026-06-24T00:00:00.000Z' },
];

function mountRouter(deps: {
  getJob: (userId: string, jobId: string) => Promise<JobRecord | undefined>;
  list: (userId: string, jobId: string) => Promise<AgentOutputRecord[]>;
}) {
  return (app: express.Express) =>
    app.use('/api/jobs', createAgentOutputsRouter({ getJob: deps.getJob, listAgentOutputs: deps.list }));
}

test('GET /api/jobs/:id/agent-outputs requires a signed-in user', async () => {
  await withServer(
    mountRouter({ getJob: async () => fakeJob, list: async () => sampleOutputs }),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/jobs/job-1/agent-outputs`);
      assert.equal(response.status, 401);
    },
  );
});

test('GET /api/jobs/:id/agent-outputs returns the saved outputs', async () => {
  await withServer(
    mountRouter({ getJob: async () => fakeJob, list: async () => sampleOutputs }),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/jobs/job-1/agent-outputs`, {
        headers: { 'X-User-Id': 'u1' },
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.outputs.length, 1);
      assert.equal(body.outputs[0].kind, 'research');
    },
  );
});

test('GET /api/jobs/:id/agent-outputs 404s for an unowned job', async () => {
  await withServer(
    mountRouter({ getJob: async () => undefined, list: async () => sampleOutputs }),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/jobs/job-9/agent-outputs`, {
        headers: { 'X-User-Id': 'u1' },
      });
      assert.equal(response.status, 404);
    },
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node --import tsx --test --test-concurrency=1 src/routes/agent-outputs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the router**

Create `apps/api/src/routes/agent-outputs.ts`:

```ts
import { Router } from 'express';
import { requireUser } from '@/lib/auth';
import { getJobById } from '@/data/job-store';
import { listAgentOutputs } from '@/data/agent-output-store';

export interface AgentOutputsDeps {
  getJob: typeof getJobById;
  listAgentOutputs: typeof listAgentOutputs;
}

const defaultDeps: AgentOutputsDeps = { getJob: getJobById, listAgentOutputs };

/** `GET /api/jobs/:id/agent-outputs` — the persisted agent outputs for a job. */
export function createAgentOutputsRouter(deps: AgentOutputsDeps = defaultDeps) {
  const router = Router();

  router.get('/:id/agent-outputs', async (request, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) return;

    try {
      const job = await deps.getJob(userId, request.params.id);
      if (!job) {
        response.status(404).json({ error: 'Job not found' });
        return;
      }
      response.json({ outputs: await deps.listAgentOutputs(userId, request.params.id) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const agentOutputsRouter = createAgentOutputsRouter();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node --import tsx --test --test-concurrency=1 src/routes/agent-outputs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Mount in `app.ts`**

In `apps/api/src/app.ts`, add the import alongside the other route imports:
```ts
import { agentOutputsRouter } from '@/routes/agent-outputs';
```

Then mount it immediately BEFORE `app.use('/api/jobs', jobsRouter);` (so `/:id/agent-outputs` is matched here; other `/api/jobs/*` paths fall through). The block becomes:
```ts
  app.use('/api/jobs', jobExtractRouter);
  app.use('/api/jobs', agentOutputsRouter);
  app.use('/api/jobs', jobsRouter);
```

- [ ] **Step 6: Full verification**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && npm run typecheck`
Expected: no errors.

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && npm run lint`
Expected: no errors.

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/api" && node scripts/run-tests.mjs`
Expected: all PASS (prior suite + the new store / persist / route tests).

- [ ] **Step 7: Commit, push, open PR**

```bash
cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot" && git add apps/api/src/routes/agent-outputs.ts apps/api/src/routes/agent-outputs.test.ts apps/api/src/app.ts && git commit -F - <<'EOF'
feat(api): GET /api/jobs/:id/agent-outputs (#121)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YY7NVS3QLuFeTqkmBaidAB
EOF
git push -u origin feat/agent-output-persistence
```

Then open the PR (base `main`), title `feat: persist AI agent outputs — backend (#118 → #121 · PR A)`, body summarising the migration + store + persist-on-run + read endpoint, ending with the Generated-with line.

---

## Self-review notes
- **Spec coverage:** 4.1 storage (migration 008 + store) = Task 1; 4.2 save = Task 2 (persist on run), load endpoint = Task 3. PR B does the UI load (4.3).
- **Type consistency:** `AgentKind` (`interview_prep|research|skill_gap`) and `AgentOutputRecord` are defined once in `agent-output-store.postgres.ts` and re-exported from `agent-output-store.ts`; `saveAgentOutput(userId, jobId, kind, payload, modelUsed?)` and `listAgentOutputs(userId, jobId)` signatures match across file/postgres/route/persist; `persistAgentRun(userId, jobId, kind, result, save?)`.
- **No placeholders:** full code + exact commands.
- **Ownership:** route handlers 404 via `getJobById`; the store scopes by `userId`; Postgres adds a `where exists` clause. No store→job-store coupling in the unit tests.
- **Offline tests:** store tests use `chdir` + file mode; route tests inject `getJob`/`listAgentOutputs`; persist test injects `save`. Nothing hits a DB.

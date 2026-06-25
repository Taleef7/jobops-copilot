# Phase 4 — Persistent AI agent outputs (design)

**Date:** 2026-06-24
**Epic:** #124 · **Phase issue:** #121
**Status:** Approved (brainstorm), pending implementation plan

## Goal

Persist interview-prep / research / skill-gap agent outputs per **(job, user)** so
they survive tab switches, reloads, and logout — and we don't pay to regenerate
them every time. Re-running is a deliberate action (no silent recompute).

## Root cause (verified)

- Agent outputs live **only in React state**: `apps/web/src/components/job-agents-panel.tsx`
  (`useState` for interview/research/skillGap), seeded to `null`.
- The endpoints `POST /api/ai/agents/{interview-prep,research,skill-gap}`
  (`apps/api/src/routes/ai.ts:249+`) call `runAgentTask(...)` and `response.json(result)` —
  they never write to the DB.
- No table exists; migrations live in `db/migrations/00N_*.sql`, applied in sorted
  order by `apps/api/scripts/db-init.ts`. Latest is `007_fts.sql`.

## Locked decisions

1. **One current output per `(job_id, kind)`** — Regenerate is an upsert that
   overwrites and refreshes `created_at`/`model_used`. No history/versioning.
2. **Persist server-side on a successful run** (in the agent endpoints),
   best-effort: a failed save must not break the user's result.
3. **Load via the server-rendered detail page** passing `initialOutputs` to the
   panel (no client fetch / loading flicker; jobs *list* stays lean).

## Architecture

### Storage — migration `db/migrations/008_agent_outputs.sql`

```sql
create table if not exists agent_outputs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  user_id text not null,
  kind text not null check (kind in ('interview_prep','research','skill_gap')),
  payload jsonb not null,
  model_used text,
  created_at timestamptz not null default now(),
  unique (job_id, kind)
);
create index if not exists agent_outputs_job_idx on agent_outputs(job_id);
```

### Store — `apps/api/src/data/agent-output-store.ts` (+ `.postgres.ts`)

Dual file/Postgres mode like `report-store` (`hasPostgresConnection()` switch;
file mode under `process.cwd()/data/agent-outputs.json` with a `dataDir()`
function + `resetForTests` for `chdir`-based test isolation).

```ts
export type AgentKind = 'interview_prep' | 'research' | 'skill_gap';

export interface AgentOutputRecord {
  jobId: string;
  kind: AgentKind;
  payload: unknown;        // the agent response JSON, stored verbatim
  modelUsed?: string;
  createdAt: string;
}

// Upsert by (jobId, kind), ownership-scoped. Overwrites payload/model/createdAt.
saveAgentOutput(userId, jobId, kind, payload, modelUsed?): Promise<AgentOutputRecord | undefined>
// The (<=3) current outputs for a job the user owns.
listAgentOutputs(userId, jobId): Promise<AgentOutputRecord[]>
```

- Postgres: `insert … on conflict (job_id, kind) do update set payload=…,
  model_used=…, created_at=now()`. Ownership verified via the `jobs` table
  (`job_id = $ and user_id = $`).
- File mode: replace any existing `(jobId, kind)` entry; ownership tracked by a
  stored `userId` per record (mirrors how the file job-store scopes by userId).
- `saveAgentOutput` returns `undefined` when the user doesn't own the job.

### Persist on run — `apps/api/src/routes/ai.ts`

In each of the 3 agent handlers, after `runAgentTask(...)` succeeds and before
`response.json(result)`:

```ts
// Best-effort: persistence must not fail the user's result.
try {
  await saveAgentOutput(userId, body.job_id, '<kind>', result, modelOf(result));
} catch (error) {
  console.error('[agents] failed to persist output', error);
}
```

`kind` per route: interview-prep → `interview_prep`, research → `research`,
skill-gap → `skill_gap`. `model_used` is taken from the agent result if it
exposes one (e.g. `result.model_used`), else left null.

### Read endpoint — `GET /api/jobs/:id/agent-outputs`

On `jobsRouter` (same auth as the rest of `/api/jobs`):

```
200 { outputs: Array<{ kind, payload, modelUsed, createdAt }> }
404 when the job isn't found / not owned
```

### Frontend

- **Web client** `apps/web/src/lib/api.ts` — `fetchAgentOutputs(jobId):
  Promise<AgentOutputItem[]>` hitting `GET /api/jobs/:id/agent-outputs`.
- **Detail page** `apps/web/src/app/(app)/jobs/[jobId]/page.tsx` — fetch agent
  outputs in parallel with the job (`Promise.all`, failure-tolerant) and pass
  them to `JobAgentsPanel` as `initialOutputs`.
- **`JobAgentsPanel`** — accept `initialOutputs?`, seed `interview`/`research`/
  `skillGap` (+ their `createdAt`/`modelUsed`) from it so a persisted output
  renders on mount. The panel's internal keys map to the store kinds:
  `interview`↔`interview_prep`, `research`↔`research`, `skillGap`↔`skill_gap`. The action button reads **"Regenerate"** when a result is
  present (else "Run agent"); regenerate hits the same endpoint (which upserts)
  and overwrites the panel state. Each rendered result shows a small
  **"Generated {date} · {model}"** line.

### Data flow

```
Run agent → POST /api/ai/agents/<kind> → runAgentTask → saveAgentOutput (upsert) → return result
Open job  → page server-fetches job + agent-outputs (parallel) → JobAgentsPanel(initialOutputs)
           → persisted output shown immediately; "Regenerate" overwrites
```

## Error handling

- Save failure on run: logged, swallowed — the user still gets the result.
- `GET …/agent-outputs` for a missing/unowned job → 404.
- Detail-page agent-output fetch failure → treated as "no outputs" (panel shows
  the run prompts); never blocks the page.
- Malformed/unknown `kind` rows from the store are ignored by the panel.

## Testing

- Store (API, dual-mode): `saveAgentOutput` upserts (second save for same
  `(job_id, kind)` overwrites, not appends); `listAgentOutputs` returns only the
  owner's rows; non-owner save returns `undefined`. File-store test via `chdir`
  + reset (mirrors `job-store.test.ts`).
- Endpoint: an agent route persists on success (inject a fake `saveAgentOutput`,
  assert called with the right kind + payload); `GET …/agent-outputs` returns
  saved rows and 404s for an unowned job; auth (401) when signed out.
- Web (vitest): `JobAgentsPanel` renders `initialOutputs` immediately; the button
  reads "Regenerate" when seeded; clicking it calls the agent API and updates the
  shown result + metadata line.

## Build slices — 2 PRs off `main`

| PR | Scope | Layer |
|----|-------|-------|
| **A** | migration `008` + `agent-output-store` (+ postgres) + persist-on-run in the 3 endpoints + `GET /api/jobs/:id/agent-outputs` + tests | backend (TDD) |
| **B** | `fetchAgentOutputs` client + detail page passes `initialOutputs` + `JobAgentsPanel` seeding / Regenerate / metadata + tests | frontend |

## YAGNI (out of scope)

No output history/versioning (one current per kind), no diffing, no streaming, no
background refresh, no new agent kinds, no embedding outputs in the jobs-list
payload.

## Workflow

Branch each slice off `main`; one PR per slice; address Codex review before
proceeding; owner merges. Verify per `docs/TESTING.md`.

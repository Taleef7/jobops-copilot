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
  const { rows } = await pool.query<AgentOutputRow>(
    `
      insert into agent_outputs (id, job_id, user_id, kind, payload, model_used, created_at)
      select $1, $2, $3, $4, $5::jsonb, $6, now()
      where exists (select 1 from jobs where id::text = $2 and user_id = $3)
      on conflict (job_id, kind) do update set
        payload = excluded.payload,
        model_used = excluded.model_used,
        created_at = now()
      -- The where-exists above already prevents a non-owner from inserting (so
      -- the conflict path is unreachable for them), but make ownership explicit
      -- on the update branch too.
      where agent_outputs.user_id = $3
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

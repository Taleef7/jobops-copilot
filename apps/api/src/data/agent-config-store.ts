/**
 * Per-agent, versioned, hot-swappable model configuration (Jobright-parity Epic 1, #251).
 *
 * Every specialist agent resolves its model from `agent_configs` at run time, so no model
 * id is hard-coded anywhere. Rows are immutable versions; exactly one row per agent is
 * `active` (enforced by a partial unique index). Swapping a model = insert the next version
 * and activate it; rollback = re-activate an older version.
 *
 * Postgres-only: there is no JSON-file fallback (unlike the job/agent-output stores). Callers
 * gate on `hasPostgresConnection()` and return 503 when the database is absent.
 */

import { getPool } from '@/lib/postgres';

export const AGENT_IDS = ['feed-curator', 'resume-tailor', 'apply-copilot', 'connection-scout'] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}

export interface AgentConfigRecord {
  agentId: AgentId;
  version: number;
  /** A LangChain `init_chat_model` string: `"provider:model-id"`. */
  model: string;
  params: Record<string, unknown>;
  promptOverrides: Record<string, unknown>;
  active: boolean;
  createdAt: string;
}

type AgentConfigRow = {
  agent_id: string;
  version: number;
  model: string;
  params: Record<string, unknown>;
  prompt_overrides: Record<string, unknown>;
  active: boolean;
  created_at: string | Date;
};

function poolOrThrow() {
  const pool = getPool();
  if (!pool) {
    throw new Error('Postgres is not configured. Set DATABASE_URL to enable agent configs.');
  }
  return pool;
}

function mapRow(row: AgentConfigRow): AgentConfigRecord {
  return {
    agentId: row.agent_id as AgentId,
    version: row.version,
    model: row.model,
    params: row.params ?? {},
    promptOverrides: row.prompt_overrides ?? {},
    active: row.active,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Every stored version for an agent, newest first. */
export async function listAgentConfigs(agentId: AgentId): Promise<AgentConfigRecord[]> {
  const { rows } = await poolOrThrow().query<AgentConfigRow>(
    `select agent_id, version, model, params, prompt_overrides, active, created_at
       from agent_configs
      where agent_id = $1
      order by version desc`,
    [agentId],
  );
  return rows.map(mapRow);
}

/**
 * Repoints `active` to an existing version. Returns false (leaving the table untouched) when
 * that version does not exist.
 *
 * Deactivate and activate are two statements inside one transaction rather than the single
 * `set active = (version = $n)` update: a partial unique index is checked per row as the
 * update walks the table, so a single statement can transiently hold two active rows and
 * fail with a duplicate-key error depending on row order. Splitting the statements makes the
 * intermediate state (zero active rows) one the index permits, and the transaction keeps it
 * invisible to everyone else.
 */
export async function activateAgentConfigVersion(agentId: AgentId, version: number): Promise<boolean> {
  const client = await poolOrThrow().connect();
  try {
    await client.query('begin');
    await client.query('update agent_configs set active = false where agent_id = $1 and active', [agentId]);
    const { rowCount } = await client.query(
      'update agent_configs set active = true where agent_id = $1 and version = $2',
      [agentId, version],
    );
    if (!rowCount) {
      await client.query('rollback');
      return false;
    }
    await client.query('commit');
    return true;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Inserts the next version for an agent and makes it active. Returns the new version number. */
export async function insertAgentConfigVersion(
  agentId: AgentId,
  model: string,
  params: Record<string, unknown>,
  promptOverrides: Record<string, unknown>,
): Promise<number> {
  const client = await poolOrThrow().connect();
  try {
    await client.query('begin');
    await client.query('update agent_configs set active = false where agent_id = $1 and active', [agentId]);
    const { rows } = await client.query<{ version: number }>(
      `insert into agent_configs (agent_id, version, model, params, prompt_overrides, active)
       select $1, coalesce(max(version), 0) + 1, $2, $3::jsonb, $4::jsonb, true
         from agent_configs where agent_id = $1
       returning version`,
      [agentId, model, JSON.stringify(params), JSON.stringify(promptOverrides)],
    );
    await client.query('commit');
    return rows[0]!.version;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

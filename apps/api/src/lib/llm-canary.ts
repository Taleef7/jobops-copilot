/**
 * The LLM canary (#348). A model the provider rejects failed every live call for 6 days
 * because nothing checked the model itself. `runLlmCanary` asks the agent for one tiny
 * real model call (`GET /health/llm`, behind the agent key); the result is kept, so
 * `/api/status` can show when it last passed without ever calling the model.
 *
 * It runs on a schedule and after deploys (`POST /internal/llm-canary`), never on a
 * user's request.
 */
import { agentHeaders } from '@/lib/agent-client';
import { getPool, hasPostgresConnection } from '@/lib/postgres';

export interface LlmCanaryResult {
  ok: boolean;
  model: string | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
}

/**
 * The agent's canary makes two model calls (structured output, then a tool call, #410), each
 * up to its 60 s request timeout, and a cold agent (scale-to-zero) can take a while to start.
 * The workflows that call /internal/llm-canary give the whole request 150 s.
 */
export const LLM_CANARY_TIMEOUT_MS = 140_000;
const CACHE_KEY = 'llm-canary:last';
/** Long enough to show the last result between daily runs. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export async function runLlmCanary(): Promise<LlmCanaryResult> {
  const checkedAt = () => new Date().toISOString();
  const fail = (error: string, model: string | null = null): LlmCanaryResult => ({
    ok: false,
    model,
    latencyMs: null,
    error,
    checkedAt: checkedAt(),
  });

  const baseUrl = process.env.AGENT_SERVICE_URL?.trim().replace(/\/$/, '');
  if (!baseUrl) return fail('The agent is not configured (AGENT_SERVICE_URL is unset).');

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/health/llm`, {
      headers: agentHeaders(),
      signal: AbortSignal.timeout(LLM_CANARY_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
    return fail(`The agent ${reason}.`);
  }

  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    model?: string;
    latency_ms?: number;
    error?: string;
  };
  if (!response.ok || body.ok !== true) {
    return fail(body.error?.trim() || `The agent answered ${response.status}.`, body.model ?? null);
  }
  return {
    ok: true,
    model: body.model ?? null,
    latencyMs: typeof body.latency_ms === 'number' ? body.latency_ms : null,
    error: null,
    checkedAt: checkedAt(),
  };
}

// The last result. In Postgres (cache_entries), so every API instance serves the same one;
// in memory in file mode.
let memoryResult: LlmCanaryResult | null = null;

export async function saveLlmCanaryResult(result: LlmCanaryResult): Promise<void> {
  const pool = hasPostgresConnection() ? getPool() : null;
  if (!pool) {
    memoryResult = result;
    return;
  }
  await pool.query(
    `insert into cache_entries (key, value, expires_at) values ($1, $2::jsonb, now() + ($3 || ' milliseconds')::interval)
     on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at`,
    [CACHE_KEY, JSON.stringify(result), String(KEEP_MS)],
  );
}

export async function getLlmCanaryResult(): Promise<LlmCanaryResult | null> {
  const pool = hasPostgresConnection() ? getPool() : null;
  if (!pool) return memoryResult;
  const { rows } = await pool.query<{ value: LlmCanaryResult }>(
    'select value from cache_entries where key = $1 and expires_at > now()',
    [CACHE_KEY],
  );
  return rows[0]?.value ?? null;
}

/** Test seam. */
export function resetLlmCanaryStoreForTests(): void {
  memoryResult = null;
}

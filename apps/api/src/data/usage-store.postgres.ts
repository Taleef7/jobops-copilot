import { getPool } from '@/lib/postgres';

function poolOrThrow() {
  const pool = getPool();
  if (!pool) {
    throw new Error('Postgres is not configured. Set DATABASE_URL to enable the database-backed store.');
  }
  return pool;
}

/** Add a paid AI call's cost to the user's row for today (UTC day), creating it if needed. */
export async function addUsage(userId: string, costUsd: number): Promise<void> {
  await poolOrThrow().query(
    `insert into ai_usage (user_id, usage_date, cost_usd, calls)
     values ($1, current_date, $2, 1)
     on conflict (user_id, usage_date)
     do update set cost_usd = ai_usage.cost_usd + excluded.cost_usd, calls = ai_usage.calls + 1`,
    [userId, costUsd],
  );
}

/** Today's accumulated spend + call count for the user (zero when no row exists). */
export async function getTodayUsage(userId: string): Promise<{ costUsd: number; calls: number }> {
  const { rows } = await poolOrThrow().query<{ cost_usd: string; calls: number }>(
    'select cost_usd, calls from ai_usage where user_id = $1 and usage_date = current_date',
    [userId],
  );
  const row = rows[0];
  return row ? { costUsd: Number(row.cost_usd), calls: Number(row.calls) } : { costUsd: 0, calls: 0 };
}

import { getPool } from '@/lib/postgres';

function poolOrThrow() {
  const pool = getPool();
  if (!pool) {
    throw new Error('Postgres is not configured. Set DATABASE_URL to enable the database-backed store.');
  }
  return pool;
}

export interface Reservation {
  allowed: boolean;
  costUsd: number;
}

/**
 * Atomically reserve `costUsd` against the user's UTC-day spend, but only while it is
 * still under `ceilingUsd`. A single statement does the check-and-increment, so
 * concurrent AI requests cannot each read an under-budget value and all slip through.
 * The UTC day is computed explicitly so a non-UTC database session can't shift the
 * budget window. A brand-new day always succeeds (the first call of the day is allowed).
 */
export async function reserveDailyBudget(
  userId: string,
  ceilingUsd: number,
  costUsd: number,
): Promise<Reservation> {
  const { rows } = await poolOrThrow().query<{ cost_usd: string }>(
    `insert into ai_usage (user_id, usage_date, cost_usd, calls)
     values ($1, (now() at time zone 'utc')::date, $2, 1)
     on conflict (user_id, usage_date) do update
       set cost_usd = ai_usage.cost_usd + excluded.cost_usd,
           calls = ai_usage.calls + 1
       where ai_usage.cost_usd < $3
     returning cost_usd`,
    [userId, costUsd, ceilingUsd],
  );
  const row = rows[0];
  return row ? { allowed: true, costUsd: Number(row.cost_usd) } : { allowed: false, costUsd: ceilingUsd };
}

/** Today's accumulated spend + call count for the user (zero when no row exists). */
export async function getTodayUsage(userId: string): Promise<{ costUsd: number; calls: number }> {
  const { rows } = await poolOrThrow().query<{ cost_usd: string; calls: number }>(
    `select cost_usd, calls from ai_usage
     where user_id = $1 and usage_date = (now() at time zone 'utc')::date`,
    [userId],
  );
  const row = rows[0];
  return row ? { costUsd: Number(row.cost_usd), calls: Number(row.calls) } : { costUsd: 0, calls: 0 };
}

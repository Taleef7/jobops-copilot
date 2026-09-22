import { getPool } from '@/lib/postgres';

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertPushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string | null;
}

type PushRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: PushRow): PushSubscriptionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function poolOrThrow() {
  const pool = getPool();
  if (!pool) {
    throw new Error('Postgres pool not initialized');
  }
  return pool;
}

export async function upsertPushSubscription(
  userId: string,
  input: UpsertPushSubscriptionInput,
): Promise<PushSubscriptionRecord> {
  const pool = poolOrThrow();
  const { rows } = await pool.query<PushRow>(
    `
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (endpoint) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        user_agent = coalesce(EXCLUDED.user_agent, push_subscriptions.user_agent),
        updated_at = NOW()
      RETURNING *
    `,
    [userId, input.endpoint, input.keys.p256dh, input.keys.auth, input.userAgent ?? null],
  );
  return mapRow(rows[0]!);
}

export async function deletePushSubscription(userId: string, endpoint: string): Promise<boolean> {
  const pool = poolOrThrow();
  const { rowCount } = await pool.query(
    `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
    [userId, endpoint],
  );
  return (rowCount ?? 0) > 0;
}

export async function deletePushSubscriptionByEndpoint(endpoint: string): Promise<boolean> {
  const pool = poolOrThrow();
  const { rowCount } = await pool.query(
    `DELETE FROM push_subscriptions WHERE endpoint = $1`,
    [endpoint],
  );
  return (rowCount ?? 0) > 0;
}

export async function listPushSubscriptions(userId: string): Promise<PushSubscriptionRecord[]> {
  const pool = poolOrThrow();
  const { rows } = await pool.query<PushRow>(
    `SELECT * FROM push_subscriptions WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map(mapRow);
}

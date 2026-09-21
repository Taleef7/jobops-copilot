import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { CreateExtTokenResult, ExtTokenRecord } from '@/types';
import { getPool } from '@/lib/postgres';

type ExtTokenRow = {
  id: string;
  user_id: string;
  token_hash: string;
  label: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

function poolOrThrow() {
  const pool = getPool();
  if (!pool) {
    throw new Error('Postgres is not configured. Set DATABASE_URL to enable the database-backed store.');
  }
  return pool;
}

function mapRow(row: ExtTokenRow): ExtTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    label: row.label,
    lastUsedAt: row.last_used_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    createdAt: row.created_at,
  };
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken.trim()).digest('hex');
}

export async function createExtToken(userId: string, label = 'Chrome Extension'): Promise<CreateExtTokenResult> {
  const rawToken = `jop_${randomBytes(24).toString('hex')}`;
  const tokenHash = hashToken(rawToken);

  const { rows } = await poolOrThrow().query<ExtTokenRow>(
    `
      INSERT INTO ext_tokens (id, user_id, token_hash, label, created_at)
      VALUES ($1, $2, $3, $4, now())
      RETURNING *
    `,
    [randomUUID(), userId, tokenHash, label.trim() || 'Chrome Extension'],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create extension token');
  }
  return {
    token: rawToken,
    record: mapRow(row),
  };
}

export async function listExtTokens(userId: string): Promise<ExtTokenRecord[]> {
  const { rows } = await poolOrThrow().query<ExtTokenRow>(
    'SELECT * FROM ext_tokens WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  );
  return rows.map(mapRow);
}

export async function findExtTokenByHash(tokenHash: string): Promise<ExtTokenRecord | undefined> {
  const { rows } = await poolOrThrow().query<ExtTokenRow>(
    'SELECT * FROM ext_tokens WHERE token_hash = $1 AND revoked_at IS NULL LIMIT 1',
    [tokenHash],
  );
  const row = rows[0];
  return row ? mapRow(row) : undefined;
}

export async function touchExtToken(tokenHash: string): Promise<void> {
  await poolOrThrow().query(
    'UPDATE ext_tokens SET last_used_at = now() WHERE token_hash = $1',
    [tokenHash],
  );
}

export async function revokeExtToken(userId: string, tokenId: string): Promise<boolean> {
  const { rowCount } = await poolOrThrow().query(
    'UPDATE ext_tokens SET revoked_at = now() WHERE user_id = $1 AND id = $2 AND revoked_at IS NULL',
    [userId, tokenId],
  );
  return (rowCount ?? 0) > 0;
}

export async function verifyAndTouchExtToken(rawToken: string): Promise<ExtTokenRecord | null> {
  const hash = hashToken(rawToken);
  const record = await findExtTokenByHash(hash);
  if (!record || record.revokedAt) {
    return null;
  }
  await touchExtToken(hash);
  record.lastUsedAt = new Date().toISOString();
  return record;
}

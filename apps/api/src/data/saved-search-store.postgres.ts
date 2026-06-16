import { randomUUID } from 'node:crypto';
import type { CreateSavedSearchBody, SavedSearch } from '@/types';
import { getPool } from '@/lib/postgres';

type SavedSearchRow = {
  id: string;
  user_id: string;
  query: string;
  location: string | null;
  remote_only: boolean;
  created_at: string;
  updated_at: string;
};

function poolOrThrow() {
  const pool = getPool();
  if (!pool) {
    throw new Error('Postgres is not configured. Set DATABASE_URL to enable the database-backed store.');
  }
  return pool;
}

function mapRow(row: SavedSearchRow): SavedSearch {
  return {
    id: row.id,
    userId: row.user_id,
    query: row.query,
    location: row.location ?? undefined,
    remoteOnly: row.remote_only,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSavedSearches(userId: string): Promise<SavedSearch[]> {
  const { rows } = await poolOrThrow().query<SavedSearchRow>(
    'select * from saved_searches where user_id = $1 order by created_at desc',
    [userId],
  );
  return rows.map(mapRow);
}

export async function createSavedSearch(userId: string, body: CreateSavedSearchBody): Promise<SavedSearch> {
  const { rows } = await poolOrThrow().query<SavedSearchRow>(
    'insert into saved_searches (id, user_id, query, location, remote_only) values ($1,$2,$3,$4,$5) returning *',
    [randomUUID(), userId, body.query.trim(), body.location?.trim() || null, Boolean(body.remoteOnly)],
  );
  const saved = rows[0];
  if (!saved) {
    throw new Error('Failed to create saved search');
  }
  return mapRow(saved);
}

export async function deleteSavedSearch(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await poolOrThrow().query(
    'delete from saved_searches where user_id = $1 and id = $2',
    [userId, id],
  );
  return (rowCount ?? 0) > 0;
}

export async function listUsersWithSavedSearches(): Promise<string[]> {
  const { rows } = await poolOrThrow().query<{ user_id: string }>('select distinct user_id from saved_searches');
  return rows.map((row) => row.user_id);
}

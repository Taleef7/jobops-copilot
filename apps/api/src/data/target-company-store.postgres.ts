import { randomUUID } from 'node:crypto';
import type { BoardType, CreateTargetCompanyBody, TargetCompany } from '@/types';
import { getPool } from '@/lib/postgres';

type TargetCompanyRow = {
  id: string;
  user_id: string;
  company: string;
  board_type: string;
  board_token: string;
  enabled: boolean;
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

function mapRow(row: TargetCompanyRow): TargetCompany {
  return {
    id: row.id,
    userId: row.user_id,
    company: row.company,
    boardType: row.board_type as BoardType,
    boardToken: row.board_token,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTargetCompanies(userId: string): Promise<TargetCompany[]> {
  const { rows } = await poolOrThrow().query<TargetCompanyRow>(
    'select * from target_companies where user_id = $1 order by created_at desc',
    [userId],
  );
  return rows.map(mapRow);
}

export async function listEnabledTargetCompanies(userId: string): Promise<TargetCompany[]> {
  const { rows } = await poolOrThrow().query<TargetCompanyRow>(
    'select * from target_companies where user_id = $1 and enabled = true order by created_at desc',
    [userId],
  );
  return rows.map(mapRow);
}

export async function createTargetCompany(userId: string, body: CreateTargetCompanyBody): Promise<TargetCompany> {
  const { rows } = await poolOrThrow().query<TargetCompanyRow>(
    'insert into target_companies (id, user_id, company, board_type, board_token) values ($1,$2,$3,$4,$5) returning *',
    [randomUUID(), userId, body.company, body.boardType, body.boardToken],
  );
  const saved = rows[0];
  if (!saved) {
    throw new Error('Failed to create target company');
  }
  return mapRow(saved);
}

export async function setTargetCompanyEnabled(
  userId: string,
  id: string,
  enabled: boolean,
): Promise<TargetCompany | undefined> {
  const { rows } = await poolOrThrow().query<TargetCompanyRow>(
    'update target_companies set enabled = $1 where user_id = $2 and id::text = $3 returning *',
    [enabled, userId, id],
  );
  const row = rows[0];
  return row ? mapRow(row) : undefined;
}

export async function deleteTargetCompany(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await poolOrThrow().query(
    'delete from target_companies where user_id = $1 and id::text = $2',
    [userId, id],
  );
  return (rowCount ?? 0) > 0;
}

export async function clearUserTargetCompanies(userId: string): Promise<void> {
  await poolOrThrow().query('delete from target_companies where user_id = $1', [userId]);
}

export async function listUsersWithEnabledTargetCompanies(): Promise<string[]> {
  const { rows } = await poolOrThrow().query<{ user_id: string }>(
    'select distinct user_id from target_companies where enabled = true',
  );
  return rows.map((row) => row.user_id);
}

import { getPool } from '@/lib/postgres';
import type { CoverLetterRecord } from '@/types';
import type { CoverLetterUpdateOptions } from './cover-letter-store';

interface CoverLetterRow {
  id: string;
  user_id: string;
  job_id: string;
  length: CoverLetterRecord['length'];
  paragraphs: unknown;
  checks: unknown;
  based_on: unknown;
  created_at: Date;
  updated_at: Date;
}

const json = <T>(value: unknown, fallback: T): T => (typeof value === 'string' ? (JSON.parse(value) as T) : ((value as T) ?? fallback));

function mapRow(row: CoverLetterRow): CoverLetterRecord {
  return {
    id: row.id,
    userId: row.user_id,
    jobId: row.job_id,
    length: row.length,
    paragraphs: json(row.paragraphs, []),
    checks: json(row.checks, []),
    basedOn: json(row.based_on, {} as CoverLetterRecord['basedOn']),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getCoverLetter(userId: string, jobId: string): Promise<CoverLetterRecord | null> {
  const { rows } = await getPool()!.query<CoverLetterRow>('SELECT * FROM cover_letters WHERE user_id = $1 AND job_id = $2 LIMIT 1', [
    userId,
    jobId,
  ]);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** The job's letter, replacing the one it had (one per job and user). */
export async function saveCoverLetter(record: CoverLetterRecord): Promise<CoverLetterRecord> {
  const { rows } = await getPool()!.query<CoverLetterRow>(
    `
      INSERT INTO cover_letters (id, user_id, job_id, length, paragraphs, checks, based_on, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8, now()), coalesce($9, now()))
      ON CONFLICT (user_id, job_id) DO UPDATE SET
        id = excluded.id,
        length = excluded.length,
        paragraphs = excluded.paragraphs,
        checks = excluded.checks,
        based_on = excluded.based_on,
        created_at = excluded.created_at,
        updated_at = greatest(excluded.updated_at, cover_letters.updated_at + interval '1 millisecond')
      RETURNING *
    `,
    [
      record.id,
      record.userId,
      record.jobId,
      record.length,
      JSON.stringify(record.paragraphs),
      JSON.stringify(record.checks),
      JSON.stringify(record.basedOn),
      record.createdAt ?? null,
      record.updatedAt ?? null,
    ],
  );
  return mapRow(rows[0]!);
}

export async function updateCoverLetter(
  userId: string,
  jobId: string,
  patch: Pick<Partial<CoverLetterRecord>, 'paragraphs' | 'checks'>,
  options: CoverLetterUpdateOptions = {},
): Promise<CoverLetterRecord | null> {
  // At least a millisecond on from before: updatedAt (to the millisecond) is what a conditional
  // update matches, so a write in the same millisecond must still change it.
  const sets = ["updated_at = greatest(now(), updated_at + interval '1 millisecond')"];
  const values: unknown[] = [userId, jobId];
  if (patch.paragraphs !== undefined) {
    values.push(JSON.stringify(patch.paragraphs));
    sets.push(`paragraphs = $${values.length}`);
  }
  if (patch.checks !== undefined) {
    values.push(JSON.stringify(patch.checks));
    sets.push(`checks = $${values.length}`);
  }
  const conditions = ['user_id = $1', 'job_id = $2'];
  if (options.expect?.updatedAt !== undefined) {
    values.push(options.expect.updatedAt);
    conditions.push(`date_trunc('milliseconds', updated_at) = $${values.length}::timestamptz`);
  }
  const { rows } = await getPool()!.query<CoverLetterRow>(
    `UPDATE cover_letters SET ${sets.join(', ')} WHERE ${conditions.join(' AND ')} RETURNING *`,
    values,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function deleteCoverLetters(userId: string): Promise<void> {
  await getPool()!.query('DELETE FROM cover_letters WHERE user_id = $1', [userId]);
}

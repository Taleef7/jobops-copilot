import { getPool } from '@/lib/postgres';
import type { ResumeVersionRecord } from '@/types';

interface ResumeVersionRow {
  id: string;
  user_id: string;
  job_id: string | null;
  base_resume_file_url: string | null;
  tailored_resume_file_url: string | null;
  change_summary: string;
  change_details: unknown;
  structured_resume: unknown;
  source_config_version: number | null;
  approved: boolean;
  is_base: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: ResumeVersionRow): ResumeVersionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    jobId: row.job_id ?? undefined,
    baseResumeFileUrl: row.base_resume_file_url ?? undefined,
    tailoredResumeFileUrl: row.tailored_resume_file_url ?? undefined,
    changeSummary: row.change_summary,
    changeDetails:
      typeof row.change_details === 'string'
        ? JSON.parse(row.change_details)
        : (row.change_details as ResumeVersionRecord['changeDetails'] ?? []),
    structuredResume:
      typeof row.structured_resume === 'string'
        ? JSON.parse(row.structured_resume)
        : (row.structured_resume as ResumeVersionRecord['structuredResume'] ?? {
            basics: { name: '', email: '', summary: '' },
            work: [],
            education: [],
            skills: [],
          }),
    sourceConfigVersion: row.source_config_version ?? undefined,
    approved: row.approved,
    isBase: row.is_base,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function insertResumeVersion(record: ResumeVersionRecord): Promise<ResumeVersionRecord> {
  const pool = getPool()!;
  const { rows } = await pool.query<ResumeVersionRow>(
    `
      INSERT INTO resume_versions (
        id, user_id, job_id, base_resume_file_url, tailored_resume_file_url,
        change_summary, change_details, structured_resume, source_config_version,
        approved, is_base, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12, now()), coalesce($13, now()))
      RETURNING *
    `,
    [
      record.id,
      record.userId,
      record.jobId ?? null,
      record.baseResumeFileUrl ?? null,
      record.tailoredResumeFileUrl ?? null,
      record.changeSummary,
      JSON.stringify(record.changeDetails ?? []),
      JSON.stringify(record.structuredResume),
      record.sourceConfigVersion ?? null,
      record.approved,
      record.isBase,
      record.createdAt ?? null,
      record.updatedAt ?? null,
    ],
  );
  return mapRow(rows[0]!);
}

export async function getResumeVersion(userId: string, id: string): Promise<ResumeVersionRecord | null> {
  const pool = getPool()!;
  const { rows } = await pool.query<ResumeVersionRow>(
    `SELECT * FROM resume_versions WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, userId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listResumeVersionsForJob(userId: string, jobId: string): Promise<ResumeVersionRecord[]> {
  const pool = getPool()!;
  const { rows } = await pool.query<ResumeVersionRow>(
    `SELECT * FROM resume_versions WHERE job_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
    [jobId, userId],
  );
  return rows.map(mapRow);
}

export async function listResumeVersionsForUser(userId: string): Promise<ResumeVersionRecord[]> {
  const pool = getPool()!;
  const { rows } = await pool.query<ResumeVersionRow>(
    `SELECT * FROM resume_versions WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(mapRow);
}

export async function getBaseResumeVersion(userId: string): Promise<ResumeVersionRecord | null> {
  const pool = getPool()!;
  const { rows } = await pool.query<ResumeVersionRow>(
    `SELECT * FROM resume_versions WHERE user_id = $1 AND is_base = true ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function updateResumeVersion(
  userId: string,
  id: string,
  patch: Partial<ResumeVersionRecord>,
): Promise<ResumeVersionRecord | null> {
  const pool = getPool()!;
  const sets: string[] = ['updated_at = now()'];
  const values: unknown[] = [id, userId];
  let paramIdx = 3;

  if (patch.approved !== undefined) {
    sets.push(`approved = $${paramIdx++}`);
    values.push(patch.approved);
  }
  if (patch.tailoredResumeFileUrl !== undefined) {
    sets.push(`tailored_resume_file_url = $${paramIdx++}`);
    values.push(patch.tailoredResumeFileUrl);
  }
  if (patch.baseResumeFileUrl !== undefined) {
    sets.push(`base_resume_file_url = $${paramIdx++}`);
    values.push(patch.baseResumeFileUrl);
  }
  if (patch.changeSummary !== undefined) {
    sets.push(`change_summary = $${paramIdx++}`);
    values.push(patch.changeSummary);
  }
  if (patch.changeDetails !== undefined) {
    sets.push(`change_details = $${paramIdx++}`);
    values.push(JSON.stringify(patch.changeDetails));
  }
  if (patch.structuredResume !== undefined) {
    sets.push(`structured_resume = $${paramIdx++}`);
    values.push(JSON.stringify(patch.structuredResume));
  }
  if (patch.isBase !== undefined) {
    sets.push(`is_base = $${paramIdx++}`);
    values.push(patch.isBase);
  }

  const { rows } = await pool.query<ResumeVersionRow>(
    `
      UPDATE resume_versions
      SET ${sets.join(', ')}
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `,
    values,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function deleteResumeVersions(userId: string): Promise<void> {
  const pool = getPool()!;
  await pool.query('DELETE FROM resume_versions WHERE user_id = $1', [userId]);
}


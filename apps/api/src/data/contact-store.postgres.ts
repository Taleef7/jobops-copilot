import { randomUUID } from 'node:crypto';
import { getPool } from '@/lib/postgres';
import type {
  CreateJobContactBody,
  JobContactEvidenceItem,
  JobContactRecord,
  JobContactStatus,
  UpdateJobContactBody,
} from '@/types';

type JobContactRow = {
  id: string;
  user_id: string;
  job_id: string;
  name: string;
  role_title: string;
  evidence: unknown;
  relevance: string | null;
  email: string | null;
  linkedin_url: string | null;
  status: JobContactStatus;
  notes: string | null;
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

export function normalizeEvidence(raw: Array<string | JobContactEvidenceItem>): JobContactEvidenceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') {
        const url = item.trim();
        return url ? { url } : null;
      }
      if (item && typeof item.url === 'string' && item.url.trim()) {
        return {
          url: item.url.trim(),
          title: item.title?.trim() || undefined,
          snippet: item.snippet?.trim() || undefined,
        };
      }
      return null;
    })
    .filter((item): item is JobContactEvidenceItem => item !== null);
}

function mapRow(row: JobContactRow): JobContactRecord {
  let parsedEvidence: JobContactEvidenceItem[] = [];
  if (Array.isArray(row.evidence)) {
    parsedEvidence = normalizeEvidence(row.evidence as Array<string | JobContactEvidenceItem>);
  } else if (typeof row.evidence === 'string') {
    try {
      const parsed = JSON.parse(row.evidence);
      if (Array.isArray(parsed)) {
        parsedEvidence = normalizeEvidence(parsed);
      }
    } catch {
      parsedEvidence = [];
    }
  }

  return {
    id: row.id,
    userId: row.user_id,
    jobId: row.job_id,
    name: row.name,
    roleTitle: row.role_title,
    evidence: parsedEvidence,
    relevance: row.relevance,
    email: row.email,
    linkedinUrl: row.linkedin_url,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listJobContacts(userId: string, jobId: string): Promise<JobContactRecord[]> {
  const { rows } = await poolOrThrow().query<JobContactRow>(
    'SELECT * FROM job_contacts WHERE user_id = $1 AND job_id = $2 ORDER BY created_at ASC',
    [userId, jobId],
  );
  return rows.map(mapRow);
}

export async function getJobContactById(userId: string, id: string): Promise<JobContactRecord | null> {
  const { rows } = await poolOrThrow().query<JobContactRow>(
    'SELECT * FROM job_contacts WHERE user_id = $1 AND id = $2',
    [userId, id],
  );
  const match = rows[0];
  return match ? mapRow(match) : null;
}

export async function insertJobContact(
  userId: string,
  jobId: string,
  body: CreateJobContactBody,
): Promise<JobContactRecord> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const evidence = normalizeEvidence(body.evidence);

  if (evidence.length === 0) {
    throw new Error('Every contact must carry at least 1 public evidence URL');
  }

  const { rows } = await poolOrThrow().query<JobContactRow>(
    `INSERT INTO job_contacts (
       id, user_id, job_id, name, role_title, evidence, relevance, email, linkedin_url, status, notes, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      id,
      userId,
      jobId,
      body.name.trim(),
      body.roleTitle.trim(),
      JSON.stringify(evidence),
      body.relevance?.trim() || null,
      body.email?.trim() || null,
      body.linkedinUrl?.trim() || null,
      body.status || 'found',
      body.notes?.trim() || null,
      now,
      now,
    ],
  );

  return mapRow(rows[0]!);
}

export async function updateJobContact(
  userId: string,
  id: string,
  patch: UpdateJobContactBody,
): Promise<JobContactRecord | null> {
  const existing = await getJobContactById(userId, id);
  if (!existing) return null;

  const now = new Date().toISOString();
  let updatedEvidence = existing.evidence;
  if (patch.evidence !== undefined) {
    const normalized = normalizeEvidence(patch.evidence);
    if (normalized.length === 0) {
      throw new Error('Every contact must carry at least 1 public evidence URL');
    }
    updatedEvidence = normalized;
  }

  const { rows } = await poolOrThrow().query<JobContactRow>(
    `UPDATE job_contacts SET
       name = COALESCE($1, name),
       role_title = COALESCE($2, role_title),
       evidence = $3::jsonb,
       relevance = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE relevance END,
       email = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE email END,
       linkedin_url = CASE WHEN $6::text IS NOT NULL THEN $6 ELSE linkedin_url END,
       status = COALESCE($7, status),
       notes = CASE WHEN $8::text IS NOT NULL THEN $8 ELSE notes END,
       updated_at = $9
     WHERE user_id = $10 AND id = $11
     RETURNING *`,
    [
      patch.name !== undefined ? patch.name.trim() : null,
      patch.roleTitle !== undefined ? patch.roleTitle.trim() : null,
      JSON.stringify(updatedEvidence),
      patch.relevance !== undefined ? patch.relevance : null,
      patch.email !== undefined ? patch.email : null,
      patch.linkedinUrl !== undefined ? patch.linkedinUrl : null,
      patch.status || null,
      patch.notes !== undefined ? patch.notes : null,
      now,
      userId,
      id,
    ],
  );

  return rows[0] ? mapRow(rows[0]) : null;
}

export async function deleteJobContact(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await poolOrThrow().query(
    'DELETE FROM job_contacts WHERE user_id = $1 AND id = $2',
    [userId, id],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Postgres side of the one-off duplicate cleanup (#346, scripts/dedupe-jobs.ts).
 * The plan itself is built by lib/job-dedupe.ts.
 */
import type { DedupePlan, DedupeRow } from '@/lib/job-dedupe';
import { canonicalJobUrl } from '@/lib/job-sources/normalize';
import { PRERANK_MODEL } from '@/lib/local-fit';
import { getPool } from '@/lib/postgres';

function poolOrThrow() {
  const pool = getPool();
  if (!pool) throw new Error('DATABASE_URL is not set.');
  return pool;
}

/** Every user who has jobs. */
export async function listUsersWithJobs(): Promise<string[]> {
  const { rows } = await poolOrThrow().query<{ user_id: string }>(
    'select distinct user_id from jobs where user_id is not null order by user_id',
  );
  return rows.map((row) => row.user_id);
}

/** A user's jobs, with the work attached to each (what deleting it would cascade away). */
export async function loadDedupeRows(userId: string): Promise<DedupeRow[]> {
  const { rows } = await poolOrThrow().query<{
    id: string;
    job_url: string | null;
    company: string;
    title: string;
    location: string | null;
    status: string;
    created_at: Date;
    notes: string | null;
    activity: number;
    scored: boolean;
  }>(
    `select j.id, j.job_url, j.company, j.title, j.location, j.status, j.created_at, j.notes,
            ((select count(*) from outreach o where o.job_id = j.id)
             + (select count(*) from job_contacts c where c.job_id = j.id)
             + (select count(*) from resume_versions r where r.job_id = j.id)
             + (select count(*) from agent_outputs a where a.job_id = j.id))::int as activity,
            (j.fit_score is not null
             and exists (select 1 from job_analysis s where s.job_id = j.id and s.model_used <> $2)) as scored
       from jobs j
      where j.user_id = $1
      order by j.created_at, j.id`,
    [userId, PRERANK_MODEL],
  );
  return rows.map((row) => ({
    id: row.id,
    jobUrl: row.job_url,
    company: row.company,
    title: row.title,
    location: row.location,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    notes: row.notes,
    activity: row.activity,
    scored: row.scored,
  }));
}

/**
 * Carry out a plan for one user, in one transaction:
 * - notifications of a deleted copy move to the kept job (`notifications.job_id` has no
 *   foreign key, so they would otherwise link to a job that no longer exists);
 * - the copies are deleted, and their analysis and status history cascade with them;
 * - the user's jobs get their canonical URL, so later lookups find them.
 * Only rows owned by `userId` are touched.
 */
export async function applyJobDedupe(userId: string, plan: DedupePlan): Promise<{ deleted: number; notificationsMoved: number }> {
  const client = await poolOrThrow().connect();
  try {
    await client.query('begin');
    let notificationsMoved = 0;
    for (const group of plan.groups) {
      if (group.skipped || group.remove.length === 0) continue;
      const moved = await client.query(
        'update notifications set job_id = $2 where user_id = $1 and job_id = any($3::text[])',
        [userId, group.keep, group.remove],
      );
      notificationsMoved += moved.rowCount ?? 0;
    }
    const deleted = await client.query('delete from jobs where user_id = $1 and id = any($2::uuid[])', [
      userId,
      plan.toDelete,
    ]);
    const { rows } = await client.query<{ id: string; job_url: string }>(
      'select id, job_url from jobs where user_id = $1 and job_url is not null',
      [userId],
    );
    if (rows.length > 0) {
      await client.query(
        `update jobs set canonical_url = batch.canonical_url
           from unnest($1::uuid[], $2::text[]) as batch(id, canonical_url)
          where jobs.id = batch.id`,
        [rows.map((row) => row.id), rows.map((row) => canonicalJobUrl(row.job_url))],
      );
    }
    await client.query('commit');
    return { deleted: deleted.rowCount ?? 0, notificationsMoved };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

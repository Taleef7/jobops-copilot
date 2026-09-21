import type { Pool } from 'pg';
import { getPool } from '@/lib/postgres';
import type { FetchedPage } from '@/lib/job-url-fetch';

export const OPEN_STATUSES = ['discovered', 'shortlisted'];

export interface LivenessResult {
  workflow: 'liveness';
  checked: number;
  active: number;
  expired: number;
  stale: number;
}

export interface LivenessDeps {
  fetchPage: (url: string) => Promise<FetchedPage>;
  pool?: Pool | null;
  listCandidates?: () => Promise<Array<{ id: string; jobUrl: string }>>;
  updateJobLiveness?: (id: string, liveness: 'active' | 'stale' | 'expired', touchSeen: boolean) => Promise<void>;
  updateLiveness?: (id: string, liveness: 'active' | 'stale' | 'expired', touchSeen: boolean) => Promise<void>;
}

export async function runLivenessSweep(deps: LivenessDeps): Promise<LivenessResult> {
  const LIVENESS_CHECK_CAP = Number(process.env.LIVENESS_CHECK_CAP ?? 100);
  const pool = deps.pool !== undefined ? deps.pool : getPool();

  let candidates: Array<{ id: string; jobUrl: string }>;

  if (deps.listCandidates) {
    candidates = await deps.listCandidates();
  } else {
    if (!pool) {
      return { workflow: 'liveness', checked: 0, active: 0, expired: 0, stale: 0 };
    }
    const { rows } = await pool.query<{ id: string; job_url: string }>(
      `select id, job_url from jobs where status = any($1) and job_url is not null and liveness <> 'expired' order by last_seen_at asc nulls first limit $2`,
      [OPEN_STATUSES, LIVENESS_CHECK_CAP],
    );
    candidates = rows.map((r) => ({ id: r.id, jobUrl: r.job_url }));
  }

  if (candidates.length === 0) {
    return { workflow: 'liveness', checked: 0, active: 0, expired: 0, stale: 0 };
  }

  const updateFn =
    deps.updateJobLiveness ??
    deps.updateLiveness ??
    (async (id: string, liveness: 'active' | 'stale' | 'expired', touchSeen: boolean) => {
      if (!pool) return;
      if (touchSeen) {
        await pool.query(
          `update jobs set liveness = $1, last_seen_at = now() where id = $2`,
          [liveness, id],
        );
      } else {
        await pool.query(
          `update jobs set liveness = $1 where id = $2`,
          [liveness, id],
        );
      }
    });

  let active = 0;
  let expired = 0;
  let stale = 0;

  for (const job of candidates) {
    const page = await deps.fetchPage(job.jobUrl);
    let liveness: 'active' | 'stale' | 'expired';
    let touchSeen = false;

    if (page.blocked !== undefined) {
      if (/HTTP (404|410)/.test(page.blocked)) {
        liveness = 'expired';
      } else {
        liveness = 'stale';
      }
    } else {
      liveness = 'active';
      touchSeen = true;
    }

    if (liveness === 'active') active += 1;
    else if (liveness === 'expired') expired += 1;
    else stale += 1;

    await updateFn(job.id, liveness, touchSeen);
  }

  return {
    workflow: 'liveness',
    checked: candidates.length,
    active,
    expired,
    stale,
  };
}

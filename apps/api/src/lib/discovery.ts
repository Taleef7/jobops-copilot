import { createJob as createJobStore, listJobs as listJobsStore } from '@/data/job-store';
import { listSavedSearches as listSavedSearchesStore } from '@/data/saved-search-store';
import type { JobSource } from '@/lib/job-sources';
import { dedupKey, fingerprintKey } from '@/lib/job-sources/normalize';

export interface DiscoveryResult {
  inserted: number;
  skipped: number;
  source: string;
}

export interface DiscoveryDeps {
  source: JobSource;
  listJobs: typeof listJobsStore;
  createJob: typeof createJobStore;
  listSavedSearches: typeof listSavedSearchesStore;
}

/**
 * Every dedup key a job occupies: its URL key (when present) *and* its
 * `company|title|location` fingerprint. Recording both for stored jobs lets a
 * URL-backed posting collide with a URL-less copy of the same posting (e.g. a
 * manually tracked job vs. a source row that omits the URL).
 */
function keysFor(job: { jobUrl?: string; company?: string; title?: string; location?: string }): string[] {
  const fingerprint = fingerprintKey(job);
  return job.jobUrl ? [job.jobUrl.toLowerCase(), fingerprint] : [fingerprint];
}

/** Postgres unique-violation — a concurrent run already inserted this posting. */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
  );
}

/**
 * Run every saved search for a user against the active job source and insert the
 * new postings into their CRM, skipping duplicates (of existing jobs and within
 * the run). A single failing search is skipped rather than aborting the run.
 */
export async function runDiscoveryForUser(userId: string, deps: DiscoveryDeps): Promise<DiscoveryResult> {
  const searches = await deps.listSavedSearches(userId);
  const seen = new Set((await deps.listJobs(userId)).flatMap(keysFor));

  let inserted = 0;
  let skipped = 0;

  for (const search of searches) {
    let found;
    try {
      found = await deps.source.search(search.query, {
        location: search.location,
        remoteOnly: search.remoteOnly,
        limit: 20,
      });
    } catch {
      continue;
    }

    for (const job of found) {
      const key = dedupKey(job);
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      // Reserve every key this posting occupies so a later URL-less/URL-backed
      // copy in the same run is recognised as a duplicate.
      for (const k of keysFor(job)) seen.add(k);
      try {
        await deps.createJob(userId, job);
        inserted += 1;
      } catch (error) {
        // A concurrent discovery run (manual click + n8n sweep, or two API
        // instances) can insert the same posting between building `seen` and
        // this insert; Postgres' per-user (user_id, job_url) unique index then
        // rejects it. Count the race as a skip instead of failing the request.
        if (isDuplicateKeyError(error)) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }
  }

  return { inserted, skipped, source: deps.source.name };
}

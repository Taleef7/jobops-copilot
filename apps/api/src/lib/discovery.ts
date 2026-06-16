import type { JobRecord } from '@/types';
import { createJob as createJobStore, listJobs as listJobsStore } from '@/data/job-store';
import { listSavedSearches as listSavedSearchesStore } from '@/data/saved-search-store';
import type { JobSource } from '@/lib/job-sources';
import { dedupKey } from '@/lib/job-sources/normalize';

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

/** Same key derivation as `dedupKey`, for the user's already-stored jobs. */
function existingKey(job: JobRecord): string {
  if (job.jobUrl) return job.jobUrl.toLowerCase();
  return [job.company, job.title, job.location].map((part) => (part ?? '').trim().toLowerCase()).join('|');
}

/**
 * Run every saved search for a user against the active job source and insert the
 * new postings into their CRM, skipping duplicates (of existing jobs and within
 * the run). A single failing search is skipped rather than aborting the run.
 */
export async function runDiscoveryForUser(userId: string, deps: DiscoveryDeps): Promise<DiscoveryResult> {
  const searches = await deps.listSavedSearches(userId);
  const seen = new Set((await deps.listJobs(userId)).map(existingKey));

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
      seen.add(key);
      await deps.createJob(userId, job);
      inserted += 1;
    }
  }

  return { inserted, skipped, source: deps.source.name };
}

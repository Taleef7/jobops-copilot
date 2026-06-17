import { normalizeRemotive, type RemotiveRaw, type SourcedJob } from './normalize';
import type { JobSearchOptions, JobSource } from './types';

const NON_GEOGRAPHIC = new Set(['remote', 'anywhere', 'worldwide', 'global']);

/**
 * Remotive job source — no API key required. Used as the always-available
 * fallback (and the default when Adzuna is not configured).
 *
 * Remotive's public API ignores the `search` and location parameters (it returns
 * a generic recent feed), so we filter client-side to respect the saved search's
 * query terms and location instead of inserting unrelated global-remote jobs.
 */
export function createRemotiveSource(): JobSource {
  return {
    name: 'remotive',
    async search(query: string, opts: JobSearchOptions = {}): Promise<SourcedJob[]> {
      const url = new URL('https://remotive.com/api/remote-jobs');
      if (query) url.searchParams.set('search', query);
      url.searchParams.set('limit', String(opts.limit ?? 50));

      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        throw new Error(`Remotive request failed: ${response.status}`);
      }
      const data = (await response.json()) as { jobs?: RemotiveRaw[] };
      let jobs = (data.jobs ?? []).map(normalizeRemotive);

      const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (terms.length > 0) {
        jobs = jobs.filter((job) => {
          const haystack = `${job.title} ${job.company} ${job.descriptionText}`.toLowerCase();
          return terms.some((term) => haystack.includes(term));
        });
      }

      const location = opts.location?.trim().toLowerCase();
      if (location && !NON_GEOGRAPHIC.has(location)) {
        jobs = jobs.filter((job) => (job.location ?? '').toLowerCase().includes(location));
      }

      return jobs;
    },
  };
}

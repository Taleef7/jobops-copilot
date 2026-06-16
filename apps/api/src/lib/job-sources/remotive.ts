import { normalizeRemotive, type RemotiveRaw, type SourcedJob } from './normalize';
import type { JobSearchOptions, JobSource } from './types';

/**
 * Remotive job source — no API key required. Used as the always-available
 * fallback (and the default when Adzuna is not configured).
 */
export function createRemotiveSource(): JobSource {
  return {
    name: 'remotive',
    async search(query: string, opts: JobSearchOptions = {}): Promise<SourcedJob[]> {
      const url = new URL('https://remotive.com/api/remote-jobs');
      if (query) url.searchParams.set('search', query);
      url.searchParams.set('limit', String(opts.limit ?? 20));

      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        throw new Error(`Remotive request failed: ${response.status}`);
      }
      const data = (await response.json()) as { jobs?: RemotiveRaw[] };
      return (data.jobs ?? []).map(normalizeRemotive);
    },
  };
}

import { normalizeAdzuna, type AdzunaRaw, type SourcedJob } from './normalize';
import type { JobSearchOptions, JobSource } from './types';

const BASE = 'https://api.adzuna.com/v1/api/jobs';

// Adzuna's `where` is a *geographic* filter — non-place values (e.g. "remote")
// return zero results. For those we skip `where` and instead bias the keyword
// query toward remote roles.
const NON_GEOGRAPHIC = new Set(['remote', 'anywhere', 'worldwide', 'global']);

/**
 * Adzuna job source. Requires a free `ADZUNA_APP_ID`/`ADZUNA_APP_KEY`. Country is
 * configurable via `ADZUNA_COUNTRY` (default `us`). Sorted by date within the last
 * 30 days for fresh, query-relevant postings. Throws on a non-2xx response so the
 * composite source can fall back to Remotive.
 */
export function createAdzunaSource(): JobSource {
  return {
    name: 'adzuna',
    async search(query: string, opts: JobSearchOptions = {}): Promise<SourcedJob[]> {
      const country = process.env.ADZUNA_COUNTRY?.trim() || 'us';
      const url = new URL(`${BASE}/${country}/search/1`);
      url.searchParams.set('app_id', process.env.ADZUNA_APP_ID ?? '');
      url.searchParams.set('app_key', process.env.ADZUNA_APP_KEY ?? '');

      const what = opts.remoteOnly ? `${query} remote` : query;
      url.searchParams.set('what', what.trim());

      const where = opts.location?.trim();
      if (where && !NON_GEOGRAPHIC.has(where.toLowerCase())) {
        url.searchParams.set('where', where);
      }

      url.searchParams.set('results_per_page', String(opts.limit ?? 20));
      // Relevance (not date) so `python developer` returns actual Python roles, not
      // just the newest loosely-matching posting; max_days_old keeps it fresh.
      url.searchParams.set('sort_by', 'relevance');
      url.searchParams.set('max_days_old', '30');
      url.searchParams.set('content-type', 'application/json');

      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        throw new Error(`Adzuna request failed: ${response.status}`);
      }
      const data = (await response.json()) as { results?: AdzunaRaw[] };
      return (data.results ?? []).map(normalizeAdzuna);
    },
  };
}

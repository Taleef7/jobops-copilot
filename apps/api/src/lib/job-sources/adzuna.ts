import { normalizeAdzuna, type AdzunaRaw, type SourcedJob } from './normalize';
import type { JobSearchOptions, JobSource } from './types';

const BASE = 'https://api.adzuna.com/v1/api/jobs';

/**
 * Adzuna job source. Requires a free `ADZUNA_APP_ID`/`ADZUNA_APP_KEY`. The
 * country is configurable via `ADZUNA_COUNTRY` (default `gb`). Throws on a
 * non-2xx response so the composite source can fall back.
 */
export function createAdzunaSource(): JobSource {
  return {
    name: 'adzuna',
    async search(query: string, opts: JobSearchOptions = {}): Promise<SourcedJob[]> {
      const country = process.env.ADZUNA_COUNTRY?.trim() || 'gb';
      const url = new URL(`${BASE}/${country}/search/1`);
      url.searchParams.set('app_id', process.env.ADZUNA_APP_ID ?? '');
      url.searchParams.set('app_key', process.env.ADZUNA_APP_KEY ?? '');
      url.searchParams.set('what', query);
      if (opts.location) url.searchParams.set('where', opts.location);
      url.searchParams.set('results_per_page', String(opts.limit ?? 20));
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

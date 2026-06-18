import { TtlCache } from '../cache';
import { createAdzunaSource } from './adzuna';
import { createRemotiveSource } from './remotive';
import type { SourcedJob } from './normalize';
import type { JobSearchOptions, JobSource } from './types';

export type { JobSource, JobSearchOptions } from './types';
export type { SourcedJob } from './normalize';

function adzunaConfigured(): boolean {
  return Boolean(process.env.ADZUNA_APP_ID?.trim() && process.env.ADZUNA_APP_KEY?.trim());
}

/**
 * Job-search cache TTL in ms (Phase 5 · R). `JOB_SEARCH_CACHE_TTL_MS`; default 5 min.
 * Set to `0` to disable caching (every search hits the upstream). Read once at module
 * load — the cache is a process-local singleton shared across requests.
 */
function jobSearchCacheTtlMs(): number {
  const raw = process.env.JOB_SEARCH_CACHE_TTL_MS;
  if (raw === undefined) return 300_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

const jobSearchCache = new TtlCache<SourcedJob[]>({ ttlMs: jobSearchCacheTtlMs() });

/** Clear the shared job-search cache (used in tests; safe to call anytime). */
export function clearJobSearchCache(): void {
  jobSearchCache.clear();
}

/** Stable cache key for a search. Country matters because Adzuna is region-scoped. */
export function jobSearchCacheKey(
  query: string,
  opts: JobSearchOptions,
  country: string,
): string {
  return JSON.stringify({
    q: query.trim().toLowerCase(),
    country,
    remoteOnly: Boolean(opts.remoteOnly),
    location: opts.location?.trim().toLowerCase() ?? null,
    limit: opts.limit ?? null,
  });
}

/**
 * Wrap a source so identical searches within the TTL are served from `cache`,
 * cutting redundant upstream calls. Only successful results are cached (errors
 * propagate and retry), so the composite source's Remotive fallback is unaffected.
 */
export function withCachedSearch(
  source: JobSource,
  cache: TtlCache<SourcedJob[]>,
  country: () => string,
): JobSource {
  return {
    get name() {
      return source.name;
    },
    async search(query, opts = {}) {
      const results = await cache.getOrCompute(jobSearchCacheKey(query, opts, country()), () =>
        source.search(query, opts),
      );
      // Copy so a caller mutating results in place can't poison the shared
      // cached array (the cache is a process-local singleton across requests).
      return results.slice();
    },
  };
}

/**
 * The active job source. When Adzuna is configured it is preferred, but any
 * failure (rate limit, 5xx, timeout) transparently falls back to Remotive — the
 * no-key source — so discovery never hard-fails on a transient upstream error.
 * Results are cached per query for `JOB_SEARCH_CACHE_TTL_MS`. `name` reflects the
 * source used by the most recent *uncached* search (a cache hit doesn't re-run the
 * source); the authoritative per-job provider is each job's `source` field.
 */
export function getJobSource(): JobSource {
  const base = adzunaConfigured() ? createComposite() : createRemotiveSource();
  return withCachedSearch(
    base,
    jobSearchCache,
    () => process.env.ADZUNA_COUNTRY?.trim() || 'us',
  );
}

function createComposite(): JobSource {
  const adzuna = createAdzunaSource();
  const remotive = createRemotiveSource();
  let used = adzuna.name;

  return {
    get name() {
      return used;
    },
    async search(query, opts) {
      try {
        used = adzuna.name;
        return await adzuna.search(query, opts);
      } catch {
        used = remotive.name;
        return remotive.search(query, opts);
      }
    },
  };
}

import { createAdzunaSource } from './adzuna';
import { createRemotiveSource } from './remotive';
import type { JobSource } from './types';

export type { JobSource, JobSearchOptions } from './types';
export type { SourcedJob } from './normalize';

function adzunaConfigured(): boolean {
  return Boolean(process.env.ADZUNA_APP_ID?.trim() && process.env.ADZUNA_APP_KEY?.trim());
}

/**
 * The active job source. When Adzuna is configured it is preferred, but any
 * failure (rate limit, 5xx, timeout) transparently falls back to Remotive — the
 * no-key source — so discovery never hard-fails on a transient upstream error.
 * `name` reflects the source actually used by the most recent `search`.
 */
export function getJobSource(): JobSource {
  if (!adzunaConfigured()) {
    return createRemotiveSource();
  }

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

/**
 * A Postgres-backed TTL cache (Phase 4 scale-prep).
 *
 * The in-memory `TtlCache` is process-local, so on a multi-instance deployment each
 * instance keeps its own copy and cache hits don't share. This backs the same
 * `AsyncTtlCache` seam with a shared `cache_entries` table. Opt-in via
 * `JOB_SEARCH_CACHE_STORE=postgres`; the in-memory default is untouched.
 *
 * Matches the in-memory semantics: a non-positive `ttlMs` disables caching, and a
 * failed `compute()` is never cached (the error propagates so the next call retries).
 */

import type { Pool } from 'pg';
import type { AsyncTtlCache } from './cache';

export interface PostgresTtlCacheOptions {
  /** Entry lifetime in ms. `<= 0` disables caching (every lookup recomputes). */
  ttlMs: number;
  /** Key namespace so different cache users can't collide in the shared table. */
  namespace: string;
}

export class PostgresTtlCache<T> implements AsyncTtlCache<T> {
  private readonly ttlMs: number;
  private readonly namespace: string;

  constructor(
    private readonly pool: Pool,
    options: PostgresTtlCacheOptions,
  ) {
    this.ttlMs = options.ttlMs;
    this.namespace = options.namespace;
  }

  private keyFor(key: string): string {
    return `${this.namespace}:${key}`;
  }

  async getOrCompute(key: string, compute: () => Promise<T>): Promise<T> {
    if (this.ttlMs <= 0) return compute();

    const namespaced = this.keyFor(key);
    const hit = await this.pool.query<{ value: T }>(
      'select value from cache_entries where key = $1 and expires_at > now()',
      [namespaced],
    );
    if (hit.rows[0]) return hit.rows[0].value; // jsonb → already-parsed value

    const value = await compute(); // errors propagate uncached, exactly like TtlCache
    await this.pool.query(
      `
        insert into cache_entries (key, value, expires_at)
        values ($1, $2::jsonb, now() + make_interval(secs => $3::double precision / 1000))
        on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at
      `,
      [namespaced, JSON.stringify(value), this.ttlMs],
    );
    return value;
  }

  async clear(): Promise<void> {
    await this.pool.query('delete from cache_entries where key like $1', [`${this.namespace}:%`]);
  }
}

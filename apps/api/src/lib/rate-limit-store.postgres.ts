/**
 * A Postgres-backed `express-rate-limit` store (Phase 4 scale-prep).
 *
 * The default MemoryStore counts requests per *process*, so on a multi-instance
 * App Service the effective limit is `configured × instanceCount` — the ceiling
 * stops meaning anything. This store keeps the fixed-window counter in a shared
 * table so the limit holds across instances. Opt-in via `RATE_LIMIT_STORE=postgres`;
 * the in-memory default is untouched for the current single-instance deployment.
 *
 * Each limiter (global vs strict) gets its own store instance with a distinct
 * `prefix` so their counters don't collide in the shared table.
 */

import type { Pool } from 'pg';
import type {
  ClientRateLimitInfo,
  IncrementResponse,
  Options,
  Store,
} from 'express-rate-limit';

interface HitRow {
  hits: number;
  expires_at: string;
}

export class PostgresRateLimitStore implements Store {
  /** express-rate-limit sets this per limiter; namespaces keys in the shared table. */
  prefix = '';
  /** Counters live in Postgres, not this process, so hits are NOT local. */
  localKeys = false as const;

  private windowMs = 60_000;

  constructor(private readonly pool: Pool) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private keyFor(key: string): string {
    return `${this.prefix}${key}`;
  }

  async increment(key: string): Promise<IncrementResponse> {
    // Atomic upsert: a live window increments; an expired/absent one starts a
    // fresh window at 1. The whole check-and-set is one statement, so concurrent
    // requests (even across instances) can't race the counter.
    const { rows } = await this.pool.query<HitRow>(
      `
        insert into rate_limit_hits (key, hits, expires_at)
        values ($1, 1, now() + make_interval(secs => $2::double precision / 1000))
        on conflict (key) do update set
          hits = case
            when rate_limit_hits.expires_at <= now() then 1
            else rate_limit_hits.hits + 1
          end,
          expires_at = case
            when rate_limit_hits.expires_at <= now()
              then now() + make_interval(secs => $2::double precision / 1000)
            else rate_limit_hits.expires_at
          end
        returning hits, expires_at
      `,
      [this.keyFor(key), this.windowMs],
    );
    const row = rows[0]!;
    return { totalHits: row.hits, resetTime: new Date(row.expires_at) };
  }

  async decrement(key: string): Promise<void> {
    await this.pool.query('update rate_limit_hits set hits = greatest(hits - 1, 0) where key = $1', [
      this.keyFor(key),
    ]);
  }

  async resetKey(key: string): Promise<void> {
    await this.pool.query('delete from rate_limit_hits where key = $1', [this.keyFor(key)]);
  }

  async resetAll(): Promise<void> {
    await this.pool.query('delete from rate_limit_hits where key like $1', [`${this.prefix}%`]);
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const { rows } = await this.pool.query<HitRow>(
      'select hits, expires_at from rate_limit_hits where key = $1 and expires_at > now()',
      [this.keyFor(key)],
    );
    const row = rows[0];
    return row ? { totalHits: row.hits, resetTime: new Date(row.expires_at) } : undefined;
  }
}

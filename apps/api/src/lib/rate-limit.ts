/**
 * Rate limiting for the API edge (Phase 2 · Workstream G).
 *
 * Requests are keyed by the Clerk user id when present (so per-user limits hold
 * across shared IPs) and fall back to the client IP otherwise. The IP fallback
 * goes through `ipKeyGenerator` so IPv6 clients are bucketed by /56 subnet rather
 * than by individual address (a single user rotating addresses can't evade the
 * limit). `keyGenerator` and `ipv6Subnet` are mutually exclusive in
 * express-rate-limit, so the subnet handling lives here, in the key generator.
 */

import type { Request } from 'express';
import rateLimit, { ipKeyGenerator, type Store } from 'express-rate-limit';
import { getPool } from './postgres';
import { PostgresRateLimitStore } from './rate-limit-store.postgres';

const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const globalMax = Number(process.env.RATE_LIMIT_MAX ?? 120);
const aiMax = Number(process.env.RATE_LIMIT_AI_MAX ?? 20);

/** The rate-limit bucket key: the user id, else the (IPv6-safe) client IP. */
export function keyForRequest(request: Pick<Request, 'userId' | 'ip'>): string {
  return request.userId ?? ipKeyGenerator(request.ip ?? '0.0.0.0', 56);
}

/**
 * Pick the counter store. `RATE_LIMIT_STORE=postgres` (with a live pool) shares the
 * counter across instances so the limit holds under scale-out; otherwise we fall back
 * to express-rate-limit's per-process MemoryStore (correct for a single instance, and
 * a safe fail-open if the flag is set but the DB is unavailable). `prefix` namespaces
 * each limiter's keys in the shared table.
 */
function makeStore(prefix: string): Store | undefined {
  if (process.env.RATE_LIMIT_STORE === 'postgres') {
    const pool = getPool();
    if (pool) {
      const store = new PostgresRateLimitStore(pool);
      store.prefix = prefix;
      return store;
    }
  }
  return undefined; // default MemoryStore
}

/** Build a limiter with an explicit per-window request `limit` and a store namespace. */
export function createRateLimiter(limit: number, namespace: string) {
  const store = makeStore(`${namespace}:`);
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (request: Request) => keyForRequest(request),
    message: { error: 'Too many requests, slow down.' },
    // With the shared Postgres store, a DB outage must not 500 every request (that would
    // take down DB-independent routes too). passOnStoreError lets the request through —
    // fail-open on availability, matching the budget guard. MemoryStore never errors.
    ...(store ? { store, passOnStoreError: true } : {}),
  });
}

/** Lenient limiter for all routes; strict limiter for the expensive AI/discovery routes. */
export const globalLimiter = createRateLimiter(globalMax, 'global');
export const strictLimiter = createRateLimiter(aiMax, 'strict');

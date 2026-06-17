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
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const globalMax = Number(process.env.RATE_LIMIT_MAX ?? 120);
const aiMax = Number(process.env.RATE_LIMIT_AI_MAX ?? 20);

/** The rate-limit bucket key: the user id, else the (IPv6-safe) client IP. */
export function keyForRequest(request: Pick<Request, 'userId' | 'ip'>): string {
  return request.userId ?? ipKeyGenerator(request.ip ?? '0.0.0.0', 56);
}

/** Build a limiter with an explicit per-window request `limit`. */
export function createRateLimiter(limit: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (request: Request) => keyForRequest(request),
    message: { error: 'Too many requests, slow down.' },
  });
}

/** Lenient limiter for all routes; strict limiter for the expensive AI/discovery routes. */
export const globalLimiter = createRateLimiter(globalMax);
export const strictLimiter = createRateLimiter(aiMax);

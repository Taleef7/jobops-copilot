/**
 * Backward-compatible list pagination (Phase 4 scale-prep).
 *
 * The list endpoints predate pagination and every client (incl. our own web,
 * which filters client-side) expects the full array. So pagination is *opt-in*:
 * no `limit` query param means "return everything", exactly as before. When a
 * caller does pass `limit`, it is clamped to a sane maximum so an explicit
 * request can't ask for an unbounded page; `offset` defaults to 0.
 *
 * Routes surface the unpaginated total via an `X-Total-Count` header so a client
 * can page without the JSON response shape having to change.
 */

/** Hard ceiling on an explicitly-requested page size. */
export const MAX_PAGE_LIMIT = 200;

export interface PageParams {
  /** Undefined ⇒ no limit (return all remaining rows). Otherwise 1..MAX_PAGE_LIMIT. */
  limit: number | undefined;
  /** Rows to skip; always ≥ 0. */
  offset: number;
}

function toPositiveInt(raw: unknown): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined;
  return n;
}

/**
 * Parse `?limit=&offset=` from an Express `request.query`. Lenient: invalid or
 * absent values fall back to the defaults (unbounded / 0) rather than erroring,
 * so a malformed query never turns a working list call into a 400.
 */
export function parsePageParams(query: unknown): PageParams {
  const q = (query ?? {}) as Record<string, unknown>;

  const rawLimit = toPositiveInt(q.limit);
  // limit <= 0 (or absent/invalid) ⇒ unbounded; otherwise clamp to the ceiling.
  const limit = rawLimit !== undefined && rawLimit > 0 ? Math.min(rawLimit, MAX_PAGE_LIMIT) : undefined;

  const rawOffset = toPositiveInt(q.offset);
  const offset = rawOffset !== undefined && rawOffset > 0 ? rawOffset : 0;

  return { limit, offset };
}

/**
 * Apply pagination to an already-materialized array (the file-mode stores and
 * any in-memory list). Postgres stores push LIMIT/OFFSET into SQL instead.
 */
export function paginateArray<T>(items: readonly T[], { limit, offset }: PageParams): T[] {
  const start = Math.min(offset, items.length);
  const end = limit === undefined ? items.length : start + limit;
  return items.slice(start, end);
}

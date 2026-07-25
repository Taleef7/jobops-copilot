-- Phase 4 scale-prep — shared, cross-instance stores for the rate-limiter and the
-- job-search cache. Both are OPT-IN (RATE_LIMIT_STORE / JOB_SEARCH_CACHE_STORE =
-- 'postgres'); the in-memory defaults are unchanged for the current single-instance
-- deployment. On a scaled-out (multi-instance) App Service these tables let every
-- instance share one rate-limit counter and one cache, instead of each keeping its own.

-- Fixed-window request counters for express-rate-limit. `key` is the limiter prefix +
-- the per-request bucket (user id or IPv6 /56 subnet); `expires_at` is the window end.
create table if not exists rate_limit_hits (
  key text primary key,
  hits integer not null default 0,
  expires_at timestamptz not null
);
create index if not exists rate_limit_hits_expires_idx on rate_limit_hits (expires_at);

-- Generic TTL key/value cache (currently the Adzuna job-search results). `value` is the
-- cached payload; a row is live only while `expires_at > now()`.
create table if not exists cache_entries (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz not null
);
create index if not exists cache_entries_expires_idx on cache_entries (expires_at);

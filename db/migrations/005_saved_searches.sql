-- Per-user saved job searches that drive manual ("Discover now") and scheduled
-- job discovery. Discovered postings land in the existing per-user `jobs` table
-- as status='discovered'; dedup is handled by the per-user (user_id, job_url)
-- unique index already created in 004_multitenant.sql.

create table if not exists saved_searches (
  id uuid primary key,
  user_id text not null,
  query text not null,
  location text,
  remote_only boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_searches_user_idx on saved_searches (user_id);

drop trigger if exists saved_searches_set_updated_at on saved_searches;

create trigger saved_searches_set_updated_at
before update on saved_searches
for each row
execute function set_updated_at();

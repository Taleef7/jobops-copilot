-- Multi-tenancy: scope all user-owned data to a Clerk user id.
--
-- Clerk gates access to the app, but the CRM was previously a single shared
-- store. This migration adds a `user_id` (Clerk user id, e.g. "user_abc123")
-- to every top-level owned entity and introduces a per-user profile that holds
-- the resume/profile text used to ground fit scoring and outreach.
--
-- Child tables (job_analysis, outreach, resume_versions) stay scoped through
-- their job_id foreign key, so only the top-level tables need the column.

-- 1. Per-user ownership columns ------------------------------------------------
alter table jobs add column if not exists user_id text;
create index if not exists jobs_user_id_idx on jobs (user_id);

alter table weekly_reports add column if not exists user_id text;
create index if not exists weekly_reports_user_id_idx on weekly_reports (user_id);
-- The old (week_start, week_end) unique index was global; scope it per-user so
-- two accounts can each have a report for the same week.
drop index if exists weekly_reports_week_range_unique_idx;
create unique index if not exists weekly_reports_user_week_range_unique_idx
  on weekly_reports (user_id, week_start, week_end);

alter table embeddings add column if not exists user_id text;
create index if not exists embeddings_user_id_idx on embeddings (user_id);

-- 2. Per-user profile (resume + profile text) ---------------------------------
create table if not exists user_profiles (
  user_id text primary key,
  display_name text,
  resume_text text,
  resume_file_name text,
  resume_file_url text,
  profile_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_profiles_set_updated_at on user_profiles;

create trigger user_profiles_set_updated_at
before update on user_profiles
for each row
execute function set_updated_at();

-- 3. Remove the legacy global demo data ---------------------------------------
-- These fixed-id rows were seeded globally and were visible to every account.
-- Real per-account sample data is now loaded on demand via POST /api/demo/seed.
delete from jobs where id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'
);
delete from weekly_reports where id = '44444444-4444-4444-8444-444444444444';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_reports'
      and column_name = 'recommendations'
      and data_type <> 'jsonb'
  ) then
    alter table weekly_reports
      alter column recommendations type jsonb using
        case
          when recommendations is null or recommendations = '' then '[]'::jsonb
          else jsonb_build_array(recommendations)
        end;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_reports'
      and column_name = 'report_markdown'
  ) then
    alter table weekly_reports
      add column report_markdown text not null default '';
    alter table weekly_reports
      alter column report_markdown drop default;
  end if;
end $$;

-- This global (week_start, week_end) uniqueness predates multi-tenancy, and 004
-- replaces it with a per-user index precisely because two accounts may each
-- hold a report for the same week. Creating it on a database that has already
-- reached 004 therefore fails on data that is legitimately duplicated — which
-- is exactly what happened to production: its tracker recorded only 001 and
-- 002_outreach, while the schema had advanced well past 004, so every run of
-- `db:init` died here and NO migration from 003 onward could ever be applied.
--
-- Skip it when the per-user index already exists. A fresh database is
-- unaffected (that index does not exist yet at this point, so the global index
-- is created and 004 drops it as before) and the end state is identical.
do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'weekly_reports_user_week_range_unique_idx'
  ) then
    create unique index if not exists weekly_reports_week_range_unique_idx
      on weekly_reports (week_start, week_end);
  end if;
end $$;

create index if not exists weekly_reports_created_at_idx
  on weekly_reports (created_at desc);

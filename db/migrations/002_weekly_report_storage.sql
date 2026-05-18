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

create unique index if not exists weekly_reports_week_range_unique_idx
  on weekly_reports (week_start, week_end);

create index if not exists weekly_reports_created_at_idx
  on weekly_reports (created_at desc);

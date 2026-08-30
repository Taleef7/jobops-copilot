-- USCIS H-1B Employer Data Hub snapshot (Jobright-parity Epic 2, spec §5/§7).
-- Global reference data (no user_id): one row per (employer, fiscal year),
-- aggregated across the per-state/NAICS rows of the USCIS export.
create table if not exists h1b_sponsors (
  id bigint generated always as identity primary key,
  employer_name text not null,
  employer_name_normalized text not null,
  fiscal_year integer not null,
  approvals integer not null default 0,
  denials integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists h1b_sponsors_employer_year_unique_idx
  on h1b_sponsors (employer_name_normalized, fiscal_year);
create index if not exists h1b_sponsors_normalized_idx
  on h1b_sponsors (employer_name_normalized);

alter table jobs alter column sponsor_likelihood type text;

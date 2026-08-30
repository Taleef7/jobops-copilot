-- ATS-board polling watchlist (Jobright-parity Epic 2, spec §5/§7).
create table if not exists target_companies (
  id uuid primary key,
  user_id text not null,
  company text not null,
  board_type text not null,
  board_token text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint target_companies_board_type_check
    check (board_type in ('greenhouse', 'lever', 'ashby'))
);
create index if not exists target_companies_user_idx on target_companies (user_id);
create unique index if not exists target_companies_user_board_unique_idx
  on target_companies (user_id, board_type, board_token);
drop trigger if exists target_companies_set_updated_at on target_companies;
create trigger target_companies_set_updated_at
before update on target_companies
for each row
execute function set_updated_at();

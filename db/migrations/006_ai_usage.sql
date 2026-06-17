-- Phase 2 · Workstream G — per-user daily AI spend, for the cost ceiling.
-- One row per (user, UTC day); the budget middleware reads today's row and the
-- AI routes increment it after a successful paid call.
create table if not exists ai_usage (
  user_id text not null,
  usage_date date not null default current_date,
  cost_usd numeric(10,4) not null default 0,
  calls integer not null default 0,
  primary key (user_id, usage_date)
);

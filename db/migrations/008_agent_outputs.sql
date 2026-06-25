-- Persisted AI agent outputs (interview prep / research / skill gap) per job.
-- One current output per (job, kind); regenerate upserts it.
create table if not exists agent_outputs (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  user_id text not null,
  kind text not null check (kind in ('interview_prep', 'research', 'skill_gap')),
  payload jsonb not null,
  model_used text,
  created_at timestamptz not null default now(),
  unique (job_id, kind)
);

create index if not exists agent_outputs_job_idx on agent_outputs (job_id);
create index if not exists agent_outputs_user_idx on agent_outputs (user_id);

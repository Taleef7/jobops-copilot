-- Per-agent, versioned, hot-swappable model configuration (Jobright-parity Epic 1, #251).
--
-- One row per (agent_id, version); exactly one active row per agent, enforced by a partial
-- unique index. Changing a model = insert the next version and repoint `active`; rollback =
-- repoint back. No deploy either way, and no model id is hard-coded in code.
--
-- `model` is a LangChain `init_chat_model` string: "provider:model-id",
-- e.g. 'anthropic:claude-haiku-4-5', 'openai:gpt-5.6-luna'.
create table if not exists agent_configs (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null check (agent_id in ('feed-curator', 'resume-tailor', 'apply-copilot', 'connection-scout')),
  version integer not null check (version >= 1),
  model text not null check (model like '%:%'),
  params jsonb not null default '{}'::jsonb,
  prompt_overrides jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (agent_id, version)
);

create unique index if not exists agent_configs_one_active_idx
  on agent_configs (agent_id) where active;

-- Initial tiering (spec section 3.3) — defaults only, swappable at runtime through
-- PUT /api/agents/:agentId/config. Cheap tier for the high-volume feed-curator, premium
-- tier for the three quality-critical agents.
insert into agent_configs (agent_id, version, model, params, active) values
  ('feed-curator',     1, 'anthropic:claude-haiku-4-5',  '{"temperature": 0.2, "max_tokens": 2048}', true),
  ('resume-tailor',    1, 'anthropic:claude-sonnet-4-6', '{"temperature": 0.2, "max_tokens": 4096}', true),
  ('apply-copilot',    1, 'anthropic:claude-sonnet-4-6', '{"temperature": 0.2, "max_tokens": 4096}', true),
  ('connection-scout', 1, 'anthropic:claude-sonnet-4-6', '{"temperature": 0.2, "max_tokens": 4096}', true)
on conflict (agent_id, version) do nothing;

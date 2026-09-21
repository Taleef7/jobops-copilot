-- Migration 019: Apply copilot data model (Jobright Parity Epic 5, #283)
-- 1. Extend agent_outputs.kind to include 'application_pack'
-- 2. Create application_answers table for apply Q&A memory
-- 3. Create ext_tokens table for Chrome extension PAT authentication

-- 1. agent_outputs kind constraint
ALTER TABLE agent_outputs DROP CONSTRAINT IF EXISTS agent_outputs_kind_check;
ALTER TABLE agent_outputs ADD CONSTRAINT agent_outputs_kind_check
  CHECK (kind IN ('interview_prep', 'research', 'skill_gap', 'application_pack'));

-- 2. application_answers table
CREATE TABLE IF NOT EXISTS application_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  question_hash text NOT NULL,
  question_text text NOT NULL,
  answer text NOT NULL,
  ats text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_hash)
);

CREATE INDEX IF NOT EXISTS application_answers_user_idx ON application_answers (user_id);
CREATE INDEX IF NOT EXISTS application_answers_hash_idx ON application_answers (user_id, question_hash);

-- 3. ext_tokens table (Personal Access Tokens for Chrome Extension)
CREATE TABLE IF NOT EXISTS ext_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT 'Chrome Extension',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ext_tokens_user_idx ON ext_tokens (user_id);
CREATE INDEX IF NOT EXISTS ext_tokens_hash_idx ON ext_tokens (token_hash);

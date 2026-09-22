-- 021_notifications.sql
-- Notification events table and user notification preferences

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('job_match', 'digest', 'follow_up', 'approval_needed', 'agent_done')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  job_id TEXT,
  dedupe_key TEXT UNIQUE,
  channels JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_dedupe_key ON notifications (dedupe_key);

-- Add preferences column to user_profiles if missing
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

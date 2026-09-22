-- Migration 018: Structured base resume and resume versions wiring (Jobright Parity Epic 4, #275)

-- 1. Extend resume_versions table
-- Make job_id nullable so canonical base resumes can have version rows without being attached to a specific job
ALTER TABLE resume_versions ALTER COLUMN job_id DROP NOT NULL;

-- Make base_resume_file_url nullable since drafts start as structured JSON before PDF rendering
ALTER TABLE resume_versions ALTER COLUMN base_resume_file_url DROP NOT NULL;

-- Add user_id directly on resume_versions for fast per-user multi-tenant queries
ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS user_id text;
CREATE INDEX IF NOT EXISTS resume_versions_user_id_idx ON resume_versions (user_id);
CREATE INDEX IF NOT EXISTS resume_versions_user_job_idx ON resume_versions (user_id, job_id);

-- Add structured_resume JSONB to store JSON-Resume compliant model
ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS structured_resume jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Add change_details JSONB to store section-by-section diff with rationale
ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS change_details jsonb DEFAULT '[]'::jsonb;

-- Add source_config_version to trace which agent model/prompt version generated it
ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS source_config_version integer;

-- Add is_base flag to identify canonical base resume versions
ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS is_base boolean NOT NULL DEFAULT false;

-- Add updated_at timestamp
ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill user_id on any existing resume_versions from their corresponding job
UPDATE resume_versions rv
SET user_id = j.user_id
FROM jobs j
WHERE rv.job_id = j.id AND rv.user_id IS NULL;

-- 2. Extend user_profiles table with base_resume JSONB
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS base_resume jsonb;

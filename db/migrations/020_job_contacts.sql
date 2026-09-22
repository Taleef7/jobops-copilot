-- Migration 020: Job Contacts table (Connection Scout, Epic 6, #290)
-- Stores verified public-web contacts for each job (recruiter, hiring manager, teammates)

CREATE TABLE IF NOT EXISTS job_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  job_id uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  name text NOT NULL,
  role_title text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  relevance text,
  email text,
  linkedin_url text,
  status text NOT NULL DEFAULT 'found' CHECK (status IN ('found', 'outreach_drafted', 'contacted', 'replied', 'archived')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_contacts_user_job_idx ON job_contacts (user_id, job_id);
CREATE INDEX IF NOT EXISTS job_contacts_job_id_idx ON job_contacts (job_id);
CREATE INDEX IF NOT EXISTS job_contacts_user_status_idx ON job_contacts (user_id, status);

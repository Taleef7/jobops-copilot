ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS salary_min integer,
  ADD COLUMN IF NOT EXISTS salary_max integer,
  ADD COLUMN IF NOT EXISTS salary_currency varchar(10),
  ADD COLUMN IF NOT EXISTS seniority varchar(20),
  ADD COLUMN IF NOT EXISTS sponsor_likelihood varchar(20),
  ADD COLUMN IF NOT EXISTS content_hash char(64),
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS liveness varchar(20) NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_jobs_content_hash ON jobs (content_hash);
CREATE INDEX IF NOT EXISTS idx_jobs_liveness ON jobs (liveness);
CREATE INDEX IF NOT EXISTS idx_jobs_salary ON jobs (salary_min, salary_max);
CREATE INDEX IF NOT EXISTS idx_jobs_seniority ON jobs (seniority);
CREATE INDEX IF NOT EXISTS idx_jobs_sponsor_likelihood ON jobs (sponsor_likelihood);

-- Migration 017: job_status_events tracking and outcome feedback (Jobright Parity Epic 2, #267)

CREATE TABLE IF NOT EXISTS job_status_events (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  user_id varchar(128) NOT NULL,
  from_status varchar(32),
  to_status varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_status_events_user_job ON job_status_events (user_id, job_id);
CREATE INDEX IF NOT EXISTS idx_job_status_events_user_to_status ON job_status_events (user_id, to_status);
CREATE INDEX IF NOT EXISTS idx_job_status_events_created_at ON job_status_events (created_at);

-- Trigger to record status transitions automatically
CREATE OR REPLACE FUNCTION record_job_status_event()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO job_status_events (job_id, user_id, from_status, to_status, created_at)
    VALUES (NEW.id, NEW.user_id, NULL, NEW.status, coalesce(NEW.updated_at, now()));
  ELSIF (TG_OP = 'UPDATE') THEN
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
      INSERT INTO job_status_events (job_id, user_id, from_status, to_status, created_at)
      VALUES (NEW.id, NEW.user_id, OLD.status, NEW.status, coalesce(NEW.updated_at, now()));
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_job_status_events ON jobs;
CREATE TRIGGER trg_job_status_events
AFTER INSERT OR UPDATE ON jobs
FOR EACH ROW EXECUTE FUNCTION record_job_status_event();

-- Backfill status events for existing jobs that don't have events recorded yet
INSERT INTO job_status_events (job_id, user_id, from_status, to_status, created_at)
SELECT id, user_id, NULL, status, updated_at
FROM jobs
WHERE NOT EXISTS (
  SELECT 1 FROM job_status_events e WHERE e.job_id = jobs.id
);

-- Outcome feedback view: calculates per-user per-company outcome heuristics
CREATE OR REPLACE VIEW view_outcome_feedback AS
WITH company_outcomes AS (
  SELECT
    j.user_id,
    lower(trim(j.company)) AS normalized_company,
    count(DISTINCT CASE WHEN e.to_status IN ('interview', 'offer') THEN j.id END) AS interview_count,
    count(DISTINCT CASE 
      WHEN j.status = 'rejected' 
       AND NOT EXISTS (
         SELECT 1 FROM job_status_events e2 
         WHERE e2.job_id = j.id AND e2.to_status IN ('interview', 'offer')
       )
      THEN j.id 
    END) AS outright_rejected_count
  FROM jobs j
  LEFT JOIN job_status_events e ON e.job_id = j.id
  GROUP BY j.user_id, lower(trim(j.company))
)
SELECT
  c.user_id,
  c.normalized_company,
  c.interview_count,
  c.outright_rejected_count,
  CASE
    WHEN c.interview_count > 0 THEN 10
    WHEN c.outright_rejected_count >= 2 THEN -15
    ELSE 0
  END AS company_score_delta
FROM company_outcomes c;

-- Migration 028: every résumé version names its owner, and a tailored version records what it
-- was based on (#351).
--
-- Every version query filters on user_id, so a version without one could never be shown.
-- A version with a job takes the job's owner; one still without an owner is removed.
--
-- Dry run on live, read-only (2026-10-03), 4 versions in all:
--   select count(*) from resume_versions where user_id is null;                    -- 0
--   select count(*) from resume_versions where user_id = 'anonymous';              -- 0
--   select count(*) from resume_versions r join jobs j on j.id = r.job_id
--    where r.user_id is distinct from j.user_id;                                   -- 0

UPDATE resume_versions r
SET user_id = j.user_id
FROM jobs j
WHERE r.job_id = j.id AND r.user_id IS NULL;

DELETE FROM resume_versions WHERE user_id IS NULL;

ALTER TABLE resume_versions ALTER COLUMN user_id SET NOT NULL;

-- What a tailored version was based on: the base résumé version and when it was saved, the
-- job, a hash of the posting, the model, and the API's grounding marker.
ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS based_on jsonb;

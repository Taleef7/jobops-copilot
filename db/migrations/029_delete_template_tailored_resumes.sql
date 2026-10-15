-- Migration 029: delete the résumé versions the API didn't check, and keep them out (#351, step 5).
--
-- Before #423, "tailoring" put "Experienced professional tailored for {title} at {company}:"
-- in front of the summary and saved that as a draft, approved or not. The agent's old
-- resume-tailor graph could also save a draft straight to the database. Neither has the API's
-- grounding marker in based_on, so the API already refuses to approve or download them
-- (422 NOT_GROUNDED). The owner chose to delete them, approved ones included (2026-10-03).
-- Base résumés and the drafts the API checked are kept.
--
-- Also removed: the "Review Tailored Resume" notifications that point at them, and the link
-- from a stored application pack to one. A stored PDF of an approved one stays in blob storage
-- with nothing pointing to it; the dry run lists them for removal by hand.
--
-- Dry run on live, read-only: DRY_RUN_PLACEHOLDER

DELETE FROM notifications
WHERE dedupe_key IN (
  SELECT 'approval_needed:resume:' || id
  FROM resume_versions
  WHERE is_base = false AND (based_on -> 'grounding' ->> 'version') IS DISTINCT FROM '1'
);

UPDATE agent_outputs
SET payload = payload || '{"resumeVersionId": null, "resumeFileUrl": null}'::jsonb
WHERE kind = 'application_pack'
  AND payload ->> 'resumeVersionId' IN (
    SELECT id::text
    FROM resume_versions
    WHERE is_base = false AND (based_on -> 'grounding' ->> 'version') IS DISTINCT FROM '1'
  );

DELETE FROM resume_versions
WHERE is_base = false AND (based_on -> 'grounding' ->> 'version') IS DISTINCT FROM '1';

-- From now on a tailored version carries the grounding marker, whoever writes it.
ALTER TABLE resume_versions
  ADD CONSTRAINT resume_versions_tailored_is_grounded
  CHECK (is_base OR (based_on -> 'grounding' ->> 'version') IS NOT NULL);

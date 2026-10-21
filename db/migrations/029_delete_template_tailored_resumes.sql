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
-- Dry run on live, read-only (2026-10-21): 4 versions, 1 base, 0 checked drafts, 3 to delete
-- (all 3 template-tailored, 2 of them approved, 2 with a stored PDF) in 1 account; 3
-- notifications removed and 1 application pack unlinked.

-- The whole table, first: no lock upgrade later (a deadlock with a delete at boot), and no
-- new row slipping in before the constraint. It's a small table; the lock lasts milliseconds.
LOCK TABLE resume_versions IN ACCESS EXCLUSIVE MODE;

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

-- From now on a tailored version carries the grounding marker (version 1, GROUNDING_VERSION in
-- lib/tailor/apply.ts: a new version means a migration to this constraint), whoever writes it. Safe to run
-- again, like the migrations before it (the runner can re-run them after a lost history).
ALTER TABLE resume_versions DROP CONSTRAINT IF EXISTS resume_versions_tailored_is_grounded;
ALTER TABLE resume_versions
  ADD CONSTRAINT resume_versions_tailored_is_grounded
  -- IS NOT DISTINCT FROM: a missing basis is NULL, and a CHECK lets NULL through.
  CHECK (is_base OR (based_on -> 'grounding' ->> 'version') IS NOT DISTINCT FROM '1');

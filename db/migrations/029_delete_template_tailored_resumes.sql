-- Migration 029: delete the template-tailored résumé versions (#351, step 5).
--
-- Before #423, "tailoring" put "Experienced professional tailored for {title} at {company}:"
-- in front of the summary and saved that as a draft, approved or not. Those versions have no
-- grounding marker in based_on, so the API already refuses to approve or download them
-- (422 NOT_GROUNDED). The owner chose to delete them, approved ones included (2026-10-03).
-- Base résumés and the drafts the API checked (based_on.grounding) are kept.
--
-- Dry run on live, read-only: DRY_RUN_PLACEHOLDER

DELETE FROM resume_versions
WHERE is_base = false
  AND (based_on IS NULL OR NOT (based_on ? 'grounding'));

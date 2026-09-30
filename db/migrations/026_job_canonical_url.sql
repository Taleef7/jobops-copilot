-- Migration 026: one key per job posting, whatever URL it was reached through (#346).
-- Discovery re-inserted the same Adzuna ad on every run because the stored URL carries
-- per-call tracking parameters. `canonical_url` holds `canonicalJobUrl(job_url)`
-- (lib/job-sources/normalize.ts): new rows get it on insert, and existing rows are
-- filled by the API right after migrations at boot (backfillCanonicalUrls), so the rule
-- lives in one place.
--
-- The index is not unique yet: live accounts still hold duplicates until
-- `scripts/dedupe-jobs.ts --apply` has run, and a unique index would fail this migration.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS canonical_url text;

CREATE INDEX IF NOT EXISTS jobs_user_canonical_url_idx
  ON jobs (user_id, canonical_url)
  WHERE canonical_url IS NOT NULL;

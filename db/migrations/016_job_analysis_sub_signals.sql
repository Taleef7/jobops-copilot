-- Add sub-signals column to job_analysis for feed curation (Jobright parity Epic 2, #265).
--
-- Holds structured components of the overall fit assessment:
-- {
--   "skills_match": 85,
--   "title_seniority": 90,
--   "salary_fit": 75,
--   "sponsorship_likelihood": 100
-- }
ALTER TABLE job_analysis
  ADD COLUMN IF NOT EXISTS sub_signals jsonb NOT NULL DEFAULT '{}'::jsonb;

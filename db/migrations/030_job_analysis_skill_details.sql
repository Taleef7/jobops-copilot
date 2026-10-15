-- Migration 030: the evidence for each matched skill and the posting's words for each missing
-- one (#354). matched_skills and missing_skills keep short labels as strings, which every API
-- and web version reads; the details go here, as [{skill, evidence}] and
-- [{skill, postingQuote}] in the same order. Null on rows from before #354: the API reads their
-- details from the labels.

ALTER TABLE job_analysis
  ADD COLUMN IF NOT EXISTS matched_skill_details jsonb,
  ADD COLUMN IF NOT EXISTS missing_skill_details jsonb;

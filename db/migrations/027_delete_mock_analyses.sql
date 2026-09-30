-- Migration 027: delete the made-up analyses (#349).
-- When the AI couldn't answer, the API used to fall back to keyword-based fakes and save
-- them as the job's analysis: 'mock-analysis-v1' (also given to every new job at creation)
-- and 'mock-fit-scorer-v1'. The fit score saved with one is just as made up, so it is
-- cleared. A next action is reset only when it is the text the app wrote after a score,
-- never one the user typed. Real scores and the labelled discovery pre-rank
-- ('local-prerank') are kept.
--
-- Dry run on live (2026-09-30): 25 'mock-analysis-v1' rows across 6 accounts, 10 of them
-- with a fit score; 0 'mock-fit-scorer-v1'.

UPDATE jobs
SET fit_score = NULL,
    next_action = CASE
      WHEN next_action = 'Review the fit summary, then draft outreach.' THEN 'Run fit scoring to analyze this role.'
      ELSE next_action
    END
WHERE id IN (
  SELECT job_id FROM job_analysis WHERE model_used IN ('mock-analysis-v1', 'mock-fit-scorer-v1')
);

DELETE FROM job_analysis
WHERE model_used IN ('mock-analysis-v1', 'mock-fit-scorer-v1');

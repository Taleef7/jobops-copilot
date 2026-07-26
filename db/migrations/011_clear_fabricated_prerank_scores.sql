-- One-time cleanup of fit scores that the pre-rank estimator never had the
-- evidence to publish.
--
-- Discovery pre-ranks each newly ingested posting with a free keyword-overlap
-- estimate: matched skills / recognised skills * 100. Job-board results make
-- that denominator tiny — Adzuna truncates descriptions to 500 characters and
-- the keyword catalog is 20 terms — so a posting typically parses to 0-2
-- recognised skills, and the ratio can only land on 0 or 100. A live pipeline
-- of 20 discovered jobs scored exactly {0 x15, 100 x5}: no intermediate value
-- existed, and a lone keyword hit rendered as a confident green "100".
--
-- The estimator now withholds the score below an evidence floor of 3 recognised
-- skills (apps/api/src/lib/local-fit.ts, MIN_EVIDENCE_SKILLS), reporting null —
-- "not scored yet" — instead of a number it cannot support. That fixes new
-- ingests but leaves every row the old code already wrote, which keeps
-- distorting the dashboard average and still draws a scored ring.
--
-- Scope: only pre-rank analyses (`model_used = 'local-prerank'`) whose parsed
-- description fell below the same floor. `parseJobDescription` fills
-- required_skills from `extractKeywords(...).slice(0, 5)`, so for any posting
-- with fewer than 5 recognised skills `jsonb_array_length(required_skills)` IS
-- the extracted-keyword count — the predicate below is exactly the floor the
-- estimator now applies, not an approximation of it.
--
-- Real LLM scores are untouched (different model_used), and so is any pre-rank
-- estimate that did clear the floor. Nulling costs nothing beyond ordering:
-- opening a job still auto-upgrades it to a real LLM score, and the UI already
-- renders null as an empty "—" ring labelled "Not scored yet".
--
-- Verified against the live database before writing: all 17 pre-rank-scored
-- jobs matched this predicate, and every one of their scores was 0 or 100 —
-- so no legitimately-computed estimate is discarded.

update jobs as j
set fit_score = null
from job_analysis as a
where a.job_id = j.id
  and a.model_used = 'local-prerank'
  and jsonb_array_length(a.required_skills) < 3
  and j.fit_score is not null;

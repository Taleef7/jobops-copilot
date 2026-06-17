"""Eval harness for JobOps Copilot agent quality (Phase 1 · Workstream A).

Scores `parse-job` with deterministic extraction metrics and `score-fit` with
Ragas (faithfulness / answer-relevance / context-recall) plus fit↔label rank
correlation, over a small hand-labeled gold set drawn from real ingested job
descriptions. Run with ``python -m evals.run``; see ``EVALS.md``.
"""

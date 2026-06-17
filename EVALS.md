# Evaluations

JobOps Copilot measures the quality of its two core LLM steps — **parse-job** and
**score-fit** — against a small, hand-labeled gold set drawn from **real ingested
job descriptions** (pulled through the live Adzuna source) plus one sample resume.

This is Phase 1 of the LLMOps work: real data in → every call traced
([Langfuse](services/agent/app/obs/langfuse.py)) → quality measured here. CI gating
on these numbers is intentionally deferred to Phase 2; today the eval job is
**report-only**.

## What's measured

**parse-job** (deterministic, no LLM judge — `evals/metrics/extraction.py`)
- **Skill precision / recall / F1** — set-based overlap between the extracted
  `required_skills` and the gold labels (case-insensitive).
- **Title accuracy / seniority accuracy** — exact (case-insensitive) match.

**score-fit** (`evals/metrics/ragas_fit.py`)
- **Fit-vs-label Spearman** — rank correlation between the model's `fit_score`
  (0–100) and the hand-assigned `fit_label`. Deterministic; the headline number
  for "does the model rank candidates the way a human would?".
- **Ragas faithfulness** — is the fit summary grounded in the resume evidence?
- **Ragas answer-relevance** — does the summary actually address the role?
- **Ragas context-recall** — did the resume evidence cover the reference rationale?

  Ragas uses an LLM judge plus the agent's existing sentence-transformers
  embeddings (no extra provider needed).

## Running it

```bash
cd services/agent
pip install -r requirements-dev.txt -r requirements-evals.txt
python -m evals.run        # writes evals/report.json + evals/report.md
```

(`requirements-evals.txt` carries Ragas; it is intentionally **not** in the
runtime image, which installs only `requirements.txt` + `requirements-rag.txt`.)

With **no provider key** configured the run **skips** and exits 0 — so CI and
key-less local runs stay green. The deterministic metric units are covered by
`pytest tests/test_evals.py`.

## Gold set

- `evals/data/parse_job.jsonl` — 17 real JDs with expected skills / title / seniority.
- `evals/data/fit_score.jsonl` — 16 real JDs with an expected `fit_label`
  (spread 10–85) and a short reference rationale.
- `evals/data/sample_resume.txt` — one candidate, scored against every posting.

## Baseline (illustrative)

Measured locally with `gpt-4o-mini` as both generator and judge (2026-06). Numbers
move with the model, the gold set, and judge variance — treat them as a starting
point, not a contract. Phase 2 adds a tracked table and CI thresholds.

| step | metric | score |
| --- | --- | --- |
| parse-job | skill F1 | 0.59 |
| parse-job | title accuracy | 0.76 |
| parse-job | seniority accuracy | 0.53 |
| score-fit | fit-vs-label Spearman | 0.68 |
| score-fit | faithfulness | 0.80 |
| score-fit | context recall | 0.51 |
| score-fit | answer relevance | 0.20 |

Faithfulness grounds claims in both the resume and the JD (a fit summary
legitimately cites role requirements). The low answer-relevance reflects the
lightweight MiniLM embeddings and the JD-as-question framing — a known baseline
to improve, not a regression.

## CI

`.github/workflows/evals.yml` runs on `services/agent/**` / `prompts/**` changes,
publishes the report to the run summary, and uploads `report.json` as an
artifact. It **does not block merges**.

The `OPENAI_API_KEY` secret is injected **only on trusted events** — push to
`main` (post-merge) and manual `workflow_dispatch` — so a keyed eval runs there.
**Pull-request** runs deliberately get no key and skip, so PR-controlled code
can never receive the provider secret. With no secret configured at all, every
run skips and stays green.

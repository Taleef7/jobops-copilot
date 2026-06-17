# Evaluations

JobOps Copilot measures the quality of its two core LLM steps — **parse-job** and
**score-fit** — against a small, hand-labeled gold set drawn from **real ingested job
descriptions** (pulled through the live Adzuna source) plus one sample resume, and
**gates** on those numbers in CI.

Real data in → every call traced ([Langfuse](services/agent/app/obs/langfuse.py)) →
quality measured and gated here.

## What's measured

**parse-job** (deterministic, no LLM judge — `evals/metrics/extraction.py`)
- **Skill precision / recall / F1** — set-based overlap between the extracted
  `required_skills` and the gold labels (case-insensitive).
- **Title accuracy / seniority accuracy** — exact (case-insensitive) match.

**score-fit** (`evals/metrics/ragas_fit.py`)
- **Fit-vs-label Spearman** — rank correlation between the model's `fit_score` (0–100)
  and the hand-assigned `fit_label`. Deterministic; the headline "does the model rank
  candidates the way a human would?" number.
- **Ragas faithfulness** — is the fit summary grounded in the resume/JD evidence?
- **Ragas answer-relevance** — does the summary actually address the role?
- **Ragas context-recall** — did the evidence cover the reference rationale?

  Ragas uses an LLM judge plus the agent's existing sentence-transformers embeddings (no
  extra provider needed).

## Gold set

- `evals/data/parse_job.jsonl` — 17 real JDs with expected skills / title / seniority.
- `evals/data/fit_score.jsonl` — 16 real JDs with an expected `fit_label` (spread 10–85)
  and a short reference rationale.
- `evals/data/sample_resume.txt` — one candidate, scored against every posting.

## Baseline & thresholds

Measured with `gpt-4o-mini` as both generator and judge (2026-06). Numbers move with the
model, the gold set, and judge variance — `evals/baseline.json` records them for
regression detection, and `evals/thresholds.json` sets the **hard CI minimums** (baseline
minus a margin for variance).

| step | metric | baseline | gate threshold |
| --- | --- | --- | --- |
| parse-job | skill F1 | 0.59 | **≥ 0.50** |
| parse-job | title accuracy | 0.76 | **≥ 0.65** |
| parse-job | seniority accuracy | 0.53 | **≥ 0.40** |
| score-fit | fit-vs-label Spearman | 0.68 | **≥ 0.45** |
| score-fit | faithfulness | 0.80 | regression-flag only |
| score-fit | context recall | 0.51 | regression-flag only |
| score-fit | answer relevance | 0.20 | regression-flag only |

The deterministic + rank metrics are **hard-gated**. The Ragas LLM-judge metrics carry
real variance, so they are tracked for **regression** (flagged as warnings when they drop
more than 0.1 below baseline) rather than hard-gated. Faithfulness grounds claims in both
the resume and the JD; the low answer-relevance reflects the lightweight MiniLM embeddings
and the JD-as-question framing — a known baseline to improve, not a regression.

## Running it

```bash
cd services/agent
pip install -r requirements-dev.txt -r requirements-evals.txt
python -m evals.run          # writes evals/report.json + evals/report.md
python -m evals.run --gate   # also fails (exit 1) if a metric is below threshold
```

(`requirements-evals.txt` carries Ragas; it is intentionally **not** in the runtime
image, which installs only `requirements.txt` + `requirements-rag.txt`.)

With **no provider key** configured the run **skips** and exits 0 (even with `--gate`) — so
key-less local and PR runs stay green. The deterministic metric units are covered by
`pytest tests/test_evals.py`.

## Two-tier CI gate

Producing the candidate parse/score still calls the LLM, so quality **cannot** be gated on
a pull request without exposing the judge key to PR-controlled code — the exfiltration risk
closed in Phase 1. Gating is therefore split:

**Tier 1 — PR gate (key-free, in the `agent` pytest job, blocks PRs).** Three pure checks
run on every PR with no secret: the eval-metric **unit tests**, a **gold-set integrity**
test (every row well-formed, `sample_resume.txt` present), and a **mock-model smoke run**
that drives the runner end-to-end with a fake model. These catch broken eval code,
malformed data, and pipeline breakage.

**Tier 2 — main quality gate (keyed, in `.github/workflows/evals.yml`).** On push-to-main
and manual dispatch the provider key is injected and the eval runs with `--gate`: it
**fails the job** when a metric drops below `evals/thresholds.json`, and **flags Ragas
regressions** (warnings) vs `evals/baseline.json`. The step is no longer
`continue-on-error`, so a failure is real.

### Security

The `OPENAI_API_KEY` secret is injected **only on trusted events** — push to `main`
(post-merge) and manual `workflow_dispatch`. **Pull-request** runs deliberately get no key
and skip, so PR-controlled code can never receive the provider secret. With no secret
configured at all, every run skips and stays green.

### Wiring the main gate to deploys

A red gate on `main` is visible immediately. To make it block releases, either mark
**Evals (report-only)** a required status check on `main` in branch protection, or add a
`workflow_run` guard on the deploy workflow so a failed gate halts the deploy.

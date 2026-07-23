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

## Retrieval-mode comparison (Phase 4)

Hybrid retrieval (dense pgvector + Postgres FTS via RRF) and the CPU cross-encoder
reranker are **measured, not assumed**. `evals/retrieval.py` runs the *same*
fit-score eval under each mode — only the evidence changes — so the table is a true
**downstream delta**.

**Ablation** — the resume reaches the model *only* through retrieval:

- **off** — no resume at all (JD only); the no-retrieval floor.
- **vector** — dense pgvector only.
- **hybrid** — dense + FTS fused via Reciprocal Rank Fusion.
- **hybrid+rerank** — the hybrid pool reranked by `cross-encoder/ms-marco-MiniLM-L-6-v2`.

**Production-path reference** — the whole resume in the prompt, which is what
`score_fit` actually receives live:

- **full-resume** — whole resume, no retrieved chunks (the no-database fallback).
- **full-resume+vector** — whole resume *plus* top-k chunks (the live RAG path).

The two groups answer different questions. The ablation asks *what does retrieval buy
versus nothing?*; the reference pair asks *what does retrieval buy on top of the real
product prompt?* — the second is the one that matters for the shipped system.

```bash
cd services/agent
python -m evals.run --retrieval-modes   # writes evals/retrieval_report.{json,md}
```

Needs **both** a `DATABASE_URL` (with the `chunk_tsv` column + `embeddings_tsv_idx`
from migration `007_fts.sql`) **and** a provider key; otherwise it writes a skipped
report and exits 0. Hybrid modes are marked **N/A** (not silently reported as ≈vector)
when the FTS column/index are absent, so a missing migration can't masquerade as "no
gain". A sweep ingests the sample resume under a dedicated `eval-harness` tenant so eval
rows can never land in a shared table as unowned (`user_id IS NULL`) data. Because the
retrieval modes feed only top-k chunks, **context-recall can fall even as
faithfulness/precision rise** — read all four columns, not one headline.

### Harness integrity

The judge's contexts are derived from the **same `Evidence` value** the generator
received (`evals/evidence.py`), so a mode cannot score better merely by showing the
judge more. This was not always true — see the correction below.

### ⚠️ Correction (2026-07-23) — the previous numbers on this page were invalid

An earlier version of this section reported that retrieval lifted faithfulness from
**0.25 → ~0.83, "a ~3× gain."** **That claim is withdrawn.** It measured what the *judge*
could see, not what retrieval contributed.

The harness passed `resume_text` to `score_fit` in **every** mode, and `score_fit` puts it
in the prompt unconditionally. So the `off` arm — documented here as "JD only, no resume
evidence at all" — had the whole resume in its prompt the entire time. Only the Ragas
judge's contexts were withheld, which manufactured a low baseline faithfulness for an arm
that was not actually resume-blind.

The tell was published in the old table and went unnoticed: `off` scored the **highest**
fit-vs-label Spearman (0.705) of any mode. A model with no resume cannot rank candidates
against a job description. Under the corrected harness the same arm scores **0.407**.

Fixed in [#197](https://github.com/Taleef7/jobops-copilot/issues/197): the judge's contexts
are now derived from the same `Evidence` value handed to the generator, and a parametrized
regression test fails if the two ever diverge again.

### Results (gpt-4o-mini judge, 2026-07-23)

Captured by `python -m evals.run --retrieval-modes`; the raw artifact is committed at
`services/agent/evals/retrieval_report.json` for auditability. n = 16, 0 errors per mode.

| mode | fit-vs-label Spearman | faithfulness | answer relevancy | context recall |
| --- | --- | --- | --- | --- |
| _Ablation_ | | | | |
| off (JD only, truly resume-blind) | 0.407 | 0.139 | 0.485 | 0.427 |
| vector | 0.721 | 0.824 | 0.212 | 0.479 |
| hybrid | 0.779 | 0.922 | 0.167 | 0.417 |
| hybrid+rerank | 0.704 | 0.777 | 0.225 | 0.427 |
| _Production-path reference_ | | | | |
| full-resume | 0.684 | 0.805 | 0.200 | **0.542** |
| full-resume+vector | 0.726 | 0.795 | 0.157 | 0.490 |

#### `hybrid` and `vector` are the same experiment — read this before comparing any two rows

On this gold set **`hybrid` and `vector` are the same experiment.** The lexical side is
structurally dead: `_lexical_candidates` builds `websearch_to_tsquery('english', <whole JD>)`,
which **ANDs** every term, so a JD becomes a ~98-node conjunction that no resume chunk can
satisfy. Verified directly against the database: **0 of 16** JDs match a single chunk, and
`hybrid` returns **byte-identical chunks to `vector` on 16/16 rows**. RRF fusing
`[dense, []]` is just `dense`.

So the apparent "hybrid beats vector" gap — Δ0.058 Spearman, Δ0.098 faithfulness — comes from
*provably identical generator input*. It is pure sampling noise (temperature 0.2 plus Ragas
judge variance).

Fixing the lexical query is tracked as
[#198](https://github.com/Taleef7/jobops-copilot/issues/198); until then, **hybrid and
hybrid+rerank are unmeasured**, not measured-and-equal.

### How much does this eval move when nothing changes?

One identical-input pair shows variance of a given size *occurred*; it does not bound the
variance. So the spread is measured directly — the same configuration, scored five times:

```bash
python -m evals.run --noise-floor 5   # writes evals/noise_report.{json,md}
```

Retrieval is frozen up front (retrieved once, reused), so every replicate receives byte-identical
evidence and all movement is generator + judge variance.

| metric | mean | stdev | min | max | max pairwise Δ |
| --- | --- | --- | --- | --- | --- |
| fit-vs-label Spearman | 0.767 | 0.034 | 0.721 | 0.797 | **0.076** |
| faithfulness | 0.778 | 0.039 | 0.741 | 0.821 | **0.080** |
| answer relevancy | 0.225 | 0.052 | 0.160 | 0.291 | **0.131** |
| context recall | 0.488 | 0.043 | 0.448 | 0.542 | **0.094** |

**Five replicates are still not enough to bound the tail, and the table above proves it.** The
sweep's `hybrid` faithfulness of **0.922** lies *outside* the entire replicate range
(0.741–0.821) — and `hybrid` is, by construction, the same experiment as `vector`. A single
extra draw landed beyond five prior ones, so treat these figures as a **floor on the spread**,
not a confidence interval. Reporting `n` and the observed range beats reporting a threshold.

**Practical rule:** a between-mode difference on the order of **0.08 Spearman / 0.08–0.10
faithfulness or smaller is unresolved** on this gold set. Resolving effects that small needs a
larger gold set, a fixed-seed judge, or replicate-averaged scores per mode — not a closer read
of a single sweep.

#### What the numbers actually support

**Retrieval works, and this is the one effect large enough to be safe.** A resume-blind model
(`off`) ranks candidates at **0.407** Spearman and grounds almost nothing (**0.139**
faithfulness) — it fabricates a candidate. Feeding it only **four retrieved chunks** gives
**0.721 / 0.824**. Those gaps are **0.31 Spearman and 0.69 faithfulness — roughly 4× and 9×
the largest no-op movement measured above.** No plausible amount of judge variance explains
them. This is the defensible result: *top-k retrieval recovers most of the model's ability to
assess a candidate, from a fraction of the context.*

**Everything else in the table is unresolved, and that is a limit of the measurement, not a
finding.** Both remaining comparisons sit inside the noise:

| comparison | Δ Spearman | Δ faithfulness | verdict |
| --- | --- | --- | --- |
| retrieval-only (`vector`) vs whole résumé (`full-resume`) | 0.037 | 0.019 | unresolved |
| `full-resume+vector` vs `full-resume` | 0.042 | 0.010 | unresolved |
| no-op replicate spread (reference) | 0.076 | 0.080 | — |

So the correct statement is *"we cannot detect a difference,"* **not** *"there is no
difference."* These deltas put a rough **upper bound on the effect size** — whatever retrieval
adds on top of a whole-résumé prompt is smaller than this setup can see. That is still useful:
it means top-k retrieval is not measurably *worse* than sending the entire résumé, which is
what justifies it here on **context efficiency** grounds. It is not evidence that retrieval is
useless on the production path, and it must not be quoted as such.

**Context-recall behaves exactly as it should**, which is a useful sanity check on the judge:
`full-resume` scores highest (0.542) because the whole resume covers the reference rationale
by construction, while top-k modes trade recall for precision.

**Answer-relevancy inverts, and that is not a win.** `off` scores *highest* (0.485) because a
model with no resume writes generic, on-topic prose about the role. The metric rewards
addressing the question, not being right — treat it as a foil, not a quality signal.

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
python -m evals.run               # writes evals/report.json + evals/report.md
python -m evals.run --gate        # also fails (exit 1) if a metric is below threshold
python -m evals.run --retrieval-modes  # per-mode retrieval comparison (needs DB + key)
python -m evals.run --noise-floor 5    # run-to-run spread, same config (needs DB + key)
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

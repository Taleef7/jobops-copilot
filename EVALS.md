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

### A second correction (2026-07-24) — the first re-measurement was still not measuring retrieval

The 2026-07-23 table above was run against a **1.5 KB résumé that chunks into exactly 4
pieces, with `k = 4`.** Every retrieval mode therefore returned *all four chunks*; retrieval
selected nothing and only changed their order. `vector` and `full-resume` were feeding the
generator the same information in different packaging, which is why they scored within noise
of each other — not because retrieval is efficient.

The claim published from it — *"top-k retrieval recovers full-résumé quality from a fraction
of the context"* — was **wrong**: top-4-of-4 is not a fraction. Two fixes landed together:

- **[#198](https://github.com/Taleef7/jobops-copilot/issues/198)** — the lexical query
  (below), and
- **the gold set** — `sample_resume.txt` expanded to a realistic length (4.2 KB → **9
  chunks**), so `k = 4` is a genuine selection of ~45%. The candidate's *qualification
  profile is unchanged* (same skills, same ~3 years, same gaps) because 10 of the 16 gold
  rationales depend on specific technologies being **absent** — only detail was added, and a
  word-boundary check asserts none of Django/Flask/AWS/GCP/TensorFlow/PyTorch/Java/Spring/
  Kubernetes/Kafka/statistics/seniority terms appear.

### Results (gpt-4o-mini judge, 9-chunk résumé, k=4, 2026-07-24)

Captured by `python -m evals.run --retrieval-modes`; the raw artifact is committed at
`services/agent/evals/retrieval_report.json` for auditability. n = 16, 0 errors per mode.

The sweep retrieves with the **parsed title + required skills**, joined from the hand-labeled
`parse_job.jsonl` gold by row id — the same fields `/score-fit` receives in production, since
the API parses before scoring. (Using the *gold* parse rather than calling `parse_job` live
keeps the sweep deterministic; a live parse would inject extraction variance into a comparison
whose deltas sit near the noise floor. 14 of 16 rows have a gold parse; the other two fall back
to keyword extraction.)

| mode | fit-vs-label Spearman | faithfulness | answer relevancy | context recall |
| --- | --- | --- | --- | --- |
| _Ablation_ | | | | |
| off (JD only, résumé-blind) | 0.233 | 0.345 | 0.381 | 0.458 |
| vector | 0.751 | 0.788 | 0.199 | 0.458 |
| hybrid | **0.839** | 0.748 | 0.138 | 0.490 |
| hybrid+rerank | 0.776 | 0.779 | 0.314 | 0.521 |
| _Production-path reference_ | | | | |
| full-resume | 0.612 | **0.816** | 0.231 | **0.583** |
| full-resume+vector | 0.570 | 0.753 | 0.220 | 0.521 |

#### The lexical side now actually fires

Before #198 the FTS half of "hybrid" was dead: `websearch_to_tsquery('english', <whole JD>)`
**ANDs** every term, so a JD became a ~98-node conjunction no chunk could satisfy. RRF fusing
`[dense, []]` is just `dense`, so hybrid was byte-identical to vector. Measured against the
database, before and after distilling the query to title + parsed skills, OR-joined:

| | before | after |
| --- | --- | --- |
| JDs whose lexical query matches ≥1 chunk | 0/16 | **16/16** |
| rows where `hybrid` retrieves different chunks than `vector` | 0/16 | **13/16** |

So hybrid is finally a real experiment — and, replicated, a better one: see the results below.

### How much does this eval move when nothing changes?

One identical-input pair shows variance of a given size *occurred*; it does not bound the
variance. So the spread is measured directly — the same configuration, scored five times:

```bash
python -m evals.run --noise-floor 5   # writes evals/noise_report.{json,md}
```

Retrieval is frozen up front (retrieved once, reused), so every replicate receives byte-identical
evidence and all movement is generator + judge variance.

`--noise-floor` takes a `mode`, because a "mode A beats mode B" claim needs **both** modes
replicated — a single sweep value has now landed outside its own five-replicate range three
separate times. Five replicates each, identical frozen evidence within each mode:

| configuration | Spearman mean | stdev | range | faithfulness mean | range |
| --- | --- | --- | --- | --- | --- |
| `vector` | 0.716 | 0.011 | 0.706 – 0.733 | 0.748 | 0.732 – 0.772 |
| `hybrid` | **0.821** | 0.021 | **0.800 – 0.848** | 0.713 | 0.666 – 0.769 |

Max pairwise Δ within a mode: **0.027** Spearman / **0.040** faithfulness for `vector`,
**0.048** / **0.103** for `hybrid`.

**The noise floor is corpus- and configuration-specific — re-measure it, never carry it over.**
Across the three gold-set/query combinations measured so far, the Spearman floor moved
0.076 → 0.063 → **0.027** and the faithfulness floor 0.080 → 0.120 → **0.040**. Any threshold
inherited from an earlier run would have mis-graded results in both directions. The sharp drop
here is itself informative: a focused, deterministic retrieval query produces markedly more
consistent generations than a sprawling one.

**Five replicates estimate the spread; they do not bound it.** Three times now a single sweep
value has fallen outside five replicates of its own configuration — most recently `vector`
scoring 0.751 in the sweep against a 0.706–0.733 replicate range. Prefer reporting `n` and the
observed range over any single threshold, and replicate anything you intend to claim.

#### What the numbers actually support

**1. Hybrid retrieval beats dense-only — established by replication, not a single sweep.**

| | `vector` | `hybrid` |
| --- | --- | --- |
| Spearman, 5 replicates | 0.716 (0.706 – 0.733) | **0.821 (0.800 – 0.848)** |

The two ranges **do not overlap**: hybrid's worst run beats vector's best by 0.067, a mean
difference of **0.105** (Welch's t ≈ 9.9). This is the first retrieval improvement this project
has been able to demonstrate — and it only became measurable once #198 revived the lexical
side, because before that hybrid retrieved byte-identical chunks to vector and *could not*
differ.

The single-sweep numbers understate it: that run's `vector` (0.751) was a high draw above its
own replicate range, making the sweep's Δ0.088 smaller than the replicated Δ0.105.

The gain is **ranking-specific**. Faithfulness moves the other way (hybrid 0.713 vs vector
0.748 by replicate mean), and with hybrid's faithfulness spread at Δ0.103 that difference is
unresolved — possibly a small real cost, possibly noise. Lexical matching appears to surface
chunks that discriminate between candidates better without grounding the prose any better.

**2. Retrieval ranks better than the whole résumé.** `vector` (0.751) and `hybrid` (0.839) both
beat `full-resume` (0.612) by far more than any measured spread, and `full-resume` sits well
below the entire replicate range of either. Feeding the model all nine chunks makes it rank
candidates *worse* than feeding it the four retrieval selected.

That reverses the intuition RAG is usually sold on here: retrieval is not a lossy compromise
accepted for context-window reasons — on this set it is a **precision filter that improves the
judgment**. Faithfulness again leans the other way (`full-resume` 0.816 is the table's best),
which is consistent — more context grounds the prose better while diluting the ranking signal.

**3. The reranker remains unresolved.** `hybrid+rerank` (0.776) sits between vector and hybrid,
and was not replicated. On a 9-chunk corpus a cross-encoder has very little to reorder; this
gold set is a weak instrument for detecting a reranking effect.

**4. The model needs the résumé.** Résumé-blind (`off`) ranks at **0.233** and grounds little
(**0.345** faithfulness). Large, unsurprising, and mostly a check that the harness measures
what it claims to.

**Context recall is too noisy to use as a judge sanity check.** `full-resume` is highest
(0.583) as expected, but the recall noise band is Δ0.125 — wider than most gaps in the column.
An earlier version of this page cited it as a sanity check; it cannot serve as one.

**Answer-relevancy inverts, and that is not a win.** `off` scores *highest* (0.369) because a
model with no résumé writes generic, on-topic prose about the role. The metric rewards
addressing the question, not being right — treat it as a foil, not a quality signal.

## Gold set

- `evals/data/parse_job.jsonl` — 17 real JDs with expected skills / title / seniority.
- `evals/data/fit_score.jsonl` — 16 real JDs with an expected `fit_label` (spread 10–85)
  and a short reference rationale.
- `evals/data/sample_resume.txt` — one candidate (4.2 KB, 9 chunks), scored against every
  posting. Expanded 2026-07-24 so `k=4` is a real selection; the qualification profile is
  unchanged because most gold rationales turn on specific technologies being absent.

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

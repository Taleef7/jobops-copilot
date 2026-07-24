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

| mode | fit-vs-label Spearman | faithfulness | answer relevancy | context recall |
| --- | --- | --- | --- | --- |
| _Ablation_ | | | | |
| off (JD only, résumé-blind) | 0.268 | 0.387 | 0.369 | 0.333 |
| vector | 0.726 | 0.769 | 0.293 | 0.427 |
| hybrid | **0.757** | 0.729 | 0.230 | 0.479 |
| hybrid+rerank | 0.729 | 0.704 | 0.180 | 0.417 |
| _Production-path reference_ | | | | |
| full-resume | 0.586 | 0.786 | 0.163 | **0.521** |
| full-resume+vector | 0.594 | **0.807** | 0.206 | 0.490 |

#### The lexical side now actually fires

Before #198 the FTS half of "hybrid" was dead: `websearch_to_tsquery('english', <whole JD>)`
**ANDs** every term, so a JD became a ~98-node conjunction no chunk could satisfy. RRF fusing
`[dense, []]` is just `dense`, so hybrid was byte-identical to vector. Measured against the
database, before and after distilling the query to title + parsed skills, OR-joined:

| | before | after |
| --- | --- | --- |
| JDs whose lexical query matches ≥1 chunk | 0/16 | **16/16** |
| rows where `hybrid` retrieves different chunks than `vector` | 0/16 | **13/16** |

So hybrid is finally a real experiment. Whether it is a *better* one is answered below — and
the answer is "we still can't tell", which is now an honest null result rather than a
structural impossibility.

### How much does this eval move when nothing changes?

One identical-input pair shows variance of a given size *occurred*; it does not bound the
variance. So the spread is measured directly — the same configuration, scored five times:

```bash
python -m evals.run --noise-floor 5   # writes evals/noise_report.{json,md}
```

Retrieval is frozen up front (retrieved once, reused), so every replicate receives byte-identical
evidence and all movement is generator + judge variance.

Measured on the current 9-chunk gold set (`vector`, 5 replicates):

| metric | mean | stdev | min | max | max pairwise Δ |
| --- | --- | --- | --- | --- | --- |
| fit-vs-label Spearman | 0.809 | 0.023 | 0.771 | 0.835 | **0.063** |
| faithfulness | 0.732 | 0.052 | 0.655 | 0.776 | **0.120** |
| answer relevancy | 0.222 | 0.029 | 0.188 | 0.250 | **0.062** |
| context recall | 0.427 | 0.049 | 0.365 | 0.490 | **0.125** |

**The noise floor is corpus-specific — re-measure it, never carry it over.** On the previous
4-chunk gold set the same procedure gave Spearman Δ0.076 / faithfulness Δ0.080. Faithfulness
noise has since grown by half (0.080 → **0.120**) while Spearman noise shrank. A threshold
inherited from an older corpus would have mis-classified results in both directions.

**Five replicates still do not bound the tail — twice now.** The `vector` row in the results
table scored **0.726** Spearman, which is *below the minimum* of five replicates of that exact
configuration (0.771–0.835). The earlier corpus produced the same surprise in the other
direction (a `hybrid` faithfulness of 0.922 against a 0.741–0.821 replicate range). Treat
these figures as a **floor on the spread**, not a confidence interval, and prefer reporting
`n` and the observed range over any single threshold.

**Practical rule:** on this gold set a difference below roughly **0.06 Spearman** or **0.12
faithfulness** is unresolved. Resolving effects that small needs more gold rows, a fixed-seed
judge, or replicate-averaged scores per mode — not a closer read of one sweep.

#### What the numbers actually support

Two effects clear the noise floor. Everything else does not.

| comparison | Δ Spearman | vs floor (0.063) | verdict |
| --- | --- | --- | --- |
| `vector` vs `off` | 0.458 | 7× | **resolved** |
| `vector` vs `full-resume` | 0.140 | 2.2× | **resolved** |
| `hybrid` vs `vector` | 0.031 | 0.5× | unresolved |
| `hybrid+rerank` vs `vector` | 0.003 | 0.05× | unresolved |
| `full-resume+vector` vs `full-resume` | 0.008 | 0.1× | unresolved |

**1. The model needs the résumé.** Résumé-blind (`off`) ranks at **0.268** Spearman and
grounds little (**0.387** faithfulness); four retrieved chunks give **0.726 / 0.769**. Large
and unsurprising — it mostly validates that the harness measures what it claims to.

**2. Retrieval ranks *better* than the whole résumé — the one genuinely interesting result.**
`vector` (0.726) beats `full-resume` (0.586) by **0.140 Spearman, 2.2× the largest no-op
movement**, and `full-resume` sits below the entire 5-replicate range of `vector`
(0.771–0.835). Feeding the model all nine chunks makes it rank candidates *worse* than feeding
it the four that retrieval selected. The extra context dilutes the signal rather than adding
to it.

That reverses the intuition RAG is usually sold on here. Retrieval is not a lossy compromise
accepted for context-window reasons — on this set it is a **precision filter that improves the
judgment**. Note the direction is specific to ranking: faithfulness slightly *favours* the
full résumé (0.786 vs 0.769), though that gap is well inside the 0.120 noise band.

**3. Hybrid and reranking remain unresolved — but now honestly so.** With the lexical side
firing (16/16) and hybrid retrieving different chunks from vector on 13/16 rows, hybrid still
lands Δ0.031 Spearman from vector — half the noise floor. The reranker is closer still
(Δ0.003). The correct statement is *"we cannot detect a difference,"* not *"there is no
difference"*: these bound the effect size at roughly the noise floor, and a 16-row set with
one résumé is a weak instrument for detecting a re-ranking improvement.

**Context recall no longer behaves as cleanly as it looked.** `full-resume` is highest (0.521
vs `vector` 0.427) as expected — the whole résumé covers the reference rationale by
construction — but Δ0.094 is *inside* the 0.125 recall noise band, so even that "obvious"
result is unresolved. A previous version of this page cited it as a judge sanity check; it is
too noisy to serve as one.

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

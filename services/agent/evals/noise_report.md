# JobOps Copilot — Eval Noise Floor

- Generated: `2026-07-24T01:13:55+00:00`
- Judge / model: `openai:gpt-4o-mini`
- Configuration: `vector` retrieval, **5 replicates**

Identical evidence every run — retrieval is frozen up front, so all movement below
is generator sampling + Ragas judge variance. Compare a between-mode delta against
`max pairwise Δ`: a difference smaller than what a *no-op change* produces is not a
result.

| metric | mean | stdev | min | max | max pairwise Δ |
| --- | --- | --- | --- | --- | --- |
| rank_correlation_spearman | 0.8091 | 0.0234 | 0.7713 | 0.8346 | **0.0633** |
| faithfulness | 0.7323 | 0.052 | 0.6552 | 0.7755 | **0.1203** |
| answer_relevancy | 0.2218 | 0.0292 | 0.1883 | 0.2503 | **0.062** |
| context_recall | 0.4271 | 0.0494 | 0.3646 | 0.4896 | **0.125** |

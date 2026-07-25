# JobOps Copilot — Eval Noise Floor

- Generated: `2026-07-24T02:06:10+00:00`
- Judge / model: `openai:gpt-4o-mini`
- Configuration: `vector` retrieval, **5 replicates**

Identical evidence every run — retrieval is frozen up front, so all movement below
is generator sampling + Ragas judge variance. Compare a between-mode delta against
`max pairwise Δ`: a difference smaller than what a *no-op change* produces is not a
result.

| metric | mean | stdev | min | max | max pairwise Δ |
| --- | --- | --- | --- | --- | --- |
| rank_correlation_spearman | 0.716 | 0.0106 | 0.706 | 0.7331 | **0.0271** |
| faithfulness | 0.7479 | 0.0148 | 0.7323 | 0.7723 | **0.04** |
| answer_relevancy | 0.2324 | 0.0231 | 0.1992 | 0.2562 | **0.057** |
| context_recall | 0.4271 | 0.0494 | 0.3646 | 0.4896 | **0.125** |

# JobOps Copilot — Eval Noise Floor

- Generated: `2026-07-23T22:45:44+00:00`
- Judge / model: `openai:gpt-4o-mini`
- Configuration: `vector` retrieval, **5 replicates**

Identical evidence every run — retrieval is frozen up front, so all movement below
is generator sampling + Ragas judge variance. Compare a between-mode delta against
`max pairwise Δ`: a difference smaller than what a *no-op change* produces is not a
result.

| metric | mean | stdev | min | max | max pairwise Δ |
| --- | --- | --- | --- | --- | --- |
| rank_correlation_spearman | 0.7668 | 0.034 | 0.7209 | 0.7973 | **0.0764** |
| faithfulness | 0.7775 | 0.0394 | 0.7409 | 0.8205 | **0.0796** |
| answer_relevancy | 0.2254 | 0.052 | 0.1604 | 0.2912 | **0.1308** |
| context_recall | 0.4875 | 0.0426 | 0.4479 | 0.5417 | **0.0938** |

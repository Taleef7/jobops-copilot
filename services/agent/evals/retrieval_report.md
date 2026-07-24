# JobOps Copilot — Retrieval-Mode Comparison

- Generated: `2026-07-24T01:56:24+00:00`
- Judge / model: `openai:gpt-4o-mini`

Same gold set + scorer; only the evidence changes (downstream delta). The judge's
contexts are derived from exactly what the generator received, so a mode cannot look
better merely by showing the judge more.

**Ablation** (`off` … `hybrid+rerank`): the resume reaches the model *only* through
retrieval — `off` gets the JD and nothing else. **Reference** (`full-resume*`): the
whole resume in the prompt, which is what `score_fit` does in production.

| mode | fit-vs-label Spearman | faithfulness | answer relevancy | context recall | n (errors) |
| --- | --- | --- | --- | --- | --- |
| off | 0.2329 | 0.3452 | 0.3808 | 0.4583 | 16 (0) |
| vector | 0.7509 | 0.7877 | 0.1994 | 0.4583 | 16 (0) |
| hybrid | 0.8389 | 0.7475 | 0.1375 | 0.4896 | 16 (0) |
| hybrid+rerank | 0.7758 | 0.7787 | 0.3139 | 0.5208 | 16 (0) |
| full-resume | 0.6117 | 0.8162 | 0.2307 | 0.5833 | 16 (0) |
| full-resume+vector | 0.5704 | 0.7534 | 0.2202 | 0.5208 | 16 (0) |

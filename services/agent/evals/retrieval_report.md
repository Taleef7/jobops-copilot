# JobOps Copilot — Retrieval-Mode Comparison

- Generated: `2026-07-23T22:22:41+00:00`
- Judge / model: `openai:gpt-4o-mini`

Same gold set + scorer; only the evidence changes (downstream delta). The judge's
contexts are derived from exactly what the generator received, so a mode cannot look
better merely by showing the judge more.

**Ablation** (`off` … `hybrid+rerank`): the resume reaches the model *only* through
retrieval — `off` gets the JD and nothing else. **Reference** (`full-resume*`): the
whole resume in the prompt, which is what `score_fit` does in production.

| mode | fit-vs-label Spearman | faithfulness | answer relevancy | context recall | n (errors) |
| --- | --- | --- | --- | --- | --- |
| off | 0.4067 | 0.1392 | 0.4847 | 0.4271 | 16 (0) |
| vector | 0.7209 | 0.8236 | 0.2124 | 0.4792 | 16 (0) |
| hybrid | 0.7789 | 0.9221 | 0.1671 | 0.4167 | 16 (0) |
| hybrid+rerank | 0.7043 | 0.7768 | 0.2245 | 0.4271 | 16 (0) |
| full-resume | 0.684 | 0.8046 | 0.1995 | 0.5417 | 16 (0) |
| full-resume+vector | 0.7262 | 0.795 | 0.1565 | 0.4896 | 16 (0) |

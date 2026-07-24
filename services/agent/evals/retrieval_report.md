# JobOps Copilot — Retrieval-Mode Comparison

- Generated: `2026-07-24T01:05:02+00:00`
- Judge / model: `openai:gpt-4o-mini`

Same gold set + scorer; only the evidence changes (downstream delta). The judge's
contexts are derived from exactly what the generator received, so a mode cannot look
better merely by showing the judge more.

**Ablation** (`off` … `hybrid+rerank`): the resume reaches the model *only* through
retrieval — `off` gets the JD and nothing else. **Reference** (`full-resume*`): the
whole resume in the prompt, which is what `score_fit` does in production.

| mode | fit-vs-label Spearman | faithfulness | answer relevancy | context recall | n (errors) |
| --- | --- | --- | --- | --- | --- |
| off | 0.2683 | 0.3868 | 0.3692 | 0.3333 | 16 (0) |
| vector | 0.7259 | 0.7693 | 0.2933 | 0.4271 | 16 (0) |
| hybrid | 0.7568 | 0.7288 | 0.2303 | 0.4792 | 16 (0) |
| hybrid+rerank | 0.7294 | 0.7041 | 0.1796 | 0.4167 | 16 (0) |
| full-resume | 0.5859 | 0.7855 | 0.1632 | 0.5208 | 16 (0) |
| full-resume+vector | 0.5938 | 0.8074 | 0.2058 | 0.4896 | 16 (0) |

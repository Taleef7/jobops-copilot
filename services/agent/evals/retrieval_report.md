# JobOps Copilot — Retrieval-Mode Comparison

- Generated: `2026-06-18T16:52:55+00:00`
- Judge / model: `openai:gpt-4o-mini`

Same gold set + scorer; only the retrieved evidence changes (downstream delta).
`off` feeds **no** resume evidence (JD only); retrieval modes feed only top-k chunks,
so context-recall can fall even as faithfulness rises — read all four columns.

| mode | fit-vs-label Spearman | faithfulness | answer relevancy | context recall | n (errors) |
| --- | --- | --- | --- | --- | --- |
| off | 0.7049 | 0.2506 | 0.2369 | 0.3333 | 16 (0) |
| vector | 0.7014 | 0.8268 | 0.1541 | 0.4792 | 16 (0) |
| hybrid | 0.687 | 0.8134 | 0.2139 | 0.3646 | 16 (0) |
| hybrid+rerank | 0.688 | 0.8036 | 0.2219 | 0.4167 | 16 (0) |

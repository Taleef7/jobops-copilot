"""Fit-score quality metrics.

Two pieces:
- ``spearman`` — deterministic rank correlation between predicted fit scores and
  the hand-labeled fit values (no LLM; unit-tested).
- ``fit_ragas_scores`` — Ragas faithfulness / answer-relevance / context-recall
  over the generated fit summaries, grounded in the resume evidence. Ragas (and
  its LLM judge) are imported lazily so this module stays importable in the light
  CI test job without ``ragas`` installed.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

# Ragas result columns that are inputs, not metric scores.
_NON_METRIC_COLUMNS = {"user_input", "response", "retrieved_contexts", "reference"}


def _rankdata(values: Sequence[float]) -> np.ndarray:
    """Average ranks (ties share the mean of their positions), like scipy.rankdata."""
    arr = np.asarray(values, dtype=float)
    order = arr.argsort()
    ranks = np.empty(len(arr), dtype=float)
    ranks[order] = np.arange(len(arr), dtype=float)
    sorted_vals = arr[order]
    i = 0
    while i < len(arr):
        j = i
        while j + 1 < len(arr) and sorted_vals[j + 1] == sorted_vals[i]:
            j += 1
        if j > i:
            ranks[order[i : j + 1]] = (i + j) / 2.0
        i = j + 1
    return ranks


def spearman(predicted: Sequence[float], gold: Sequence[float]) -> float | None:
    """Spearman rank correlation; ``None`` when undefined (n<2, length mismatch,
    or one side has zero variance)."""
    if len(predicted) != len(gold) or len(predicted) < 2:
        return None
    rank_pred = _rankdata(predicted)
    rank_gold = _rankdata(gold)
    if rank_pred.std() == 0 or rank_gold.std() == 0:
        return None
    return round(float(np.corrcoef(rank_pred, rank_gold)[0, 1]), 4)


def mean(values: Sequence[float | None]) -> float | None:
    """Mean of the non-None values, or ``None`` if there are none."""
    present = [v for v in values if v is not None]
    return round(sum(present) / len(present), 4) if present else None


def fit_ragas_scores(samples: list[dict], judge_llm, embeddings=None) -> dict[str, float | None]:
    """Run Ragas over fit-score samples and return the mean of each metric.

    Each sample is a dict with ``user_input``, ``response``, ``retrieved_contexts``
    and ``reference``. Faithfulness and context-recall use only the LLM judge;
    answer-relevance is added only when ``embeddings`` is provided.
    """
    from evals._ragas_compat import ensure_ragas_importable

    ensure_ragas_importable()

    from ragas import evaluate
    from ragas.dataset_schema import EvaluationDataset, SingleTurnSample
    from ragas.llms import LangchainLLMWrapper
    from ragas.metrics import Faithfulness, LLMContextRecall

    wrapped_llm = LangchainLLMWrapper(judge_llm)
    metrics = [Faithfulness(llm=wrapped_llm), LLMContextRecall(llm=wrapped_llm)]
    if embeddings is not None:
        from ragas.embeddings import LangchainEmbeddingsWrapper
        from ragas.metrics import ResponseRelevancy

        metrics.append(
            ResponseRelevancy(llm=wrapped_llm, embeddings=LangchainEmbeddingsWrapper(embeddings))
        )

    dataset = EvaluationDataset(samples=[SingleTurnSample(**sample) for sample in samples])
    result = evaluate(dataset=dataset, metrics=metrics)

    import pandas as pd

    frame = result.to_pandas()
    scores: dict[str, float | None] = {}
    for column in frame.columns:
        if column in _NON_METRIC_COLUMNS:
            continue
        series = pd.to_numeric(frame[column], errors="coerce").dropna()
        scores[column] = round(float(series.mean()), 4) if len(series) else None
    return scores

"""Deterministic metrics for `parse-job` extraction quality (no LLM judge).

`skill_prf` scores extracted skill lists with set-based precision/recall/F1, and
`exact_match` scores scalar fields (title, seniority). Both are case-insensitive
and whitespace-insensitive so trivial formatting differences don't count as errors.
"""

from __future__ import annotations

from collections.abc import Iterable


def _normalize(items: Iterable[str]) -> set[str]:
    """Lowercase, strip, and drop blanks — so {"Python", "python ", ""} -> {"python"}."""
    return {item.strip().lower() for item in items if item and item.strip()}


def skill_prf(predicted: Iterable[str], gold: Iterable[str]) -> tuple[float, float, float]:
    """Set-based precision, recall, F1 for a predicted skill list vs. the gold list.

    Both lists are normalized (case/space-insensitive, de-duplicated). Two empty
    lists count as a perfect match; otherwise precision/recall fall back to 0.0
    when their denominator is empty.
    """
    predicted_set = _normalize(predicted)
    gold_set = _normalize(gold)
    if not predicted_set and not gold_set:
        return (1.0, 1.0, 1.0)

    true_positives = len(predicted_set & gold_set)
    precision = true_positives / len(predicted_set) if predicted_set else 0.0
    recall = true_positives / len(gold_set) if gold_set else 0.0
    f1 = (
        2 * precision * recall / (precision + recall)
        if (precision + recall) > 0
        else 0.0
    )
    return (precision, recall, f1)


def exact_match(predicted: str | None, gold: str | None) -> float:
    """1.0 when the two scalars match case/space-insensitively, else 0.0."""
    return 1.0 if (predicted or "").strip().lower() == (gold or "").strip().lower() else 0.0

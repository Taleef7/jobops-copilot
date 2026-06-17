"""Eval gate (Phase 2 · Workstream J): turn a report into pass/fail.

`check_thresholds` hard-gates the deterministic + rank metrics against committed minimums
(`thresholds.json`). `check_regression` flags drops vs a stored baseline (`baseline.json`)
— surfaced as warnings rather than hard failures, since the Ragas LLM-judge metrics carry
real variance. A skipped report (no provider key) gates nothing, so key-less PR runs and
local runs stay green.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_DIR = Path(__file__).parent


def _flatten(report: dict[str, Any]) -> dict[str, float]:
    """Collect numeric metrics from the parse_job / fit_score sections (incl. nested ragas)."""
    flat: dict[str, float] = {}
    for section in ("parse_job", "fit_score"):
        data = report.get(section)
        if not isinstance(data, dict):
            continue
        for key, value in data.items():
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                flat[key] = float(value)
        ragas = data.get("ragas")
        if isinstance(ragas, dict):
            for key, value in ragas.items():
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    flat[key] = float(value)
    return flat


def check_thresholds(report: dict[str, Any], thresholds: dict[str, float]) -> list[str]:
    """Return human-readable failures for metrics below their committed minimum.

    Returns ``[]`` when the report is not ``status == "ok"`` (a skipped run gates nothing).
    On an ok run, a thresholded metric that is absent/``None`` is itself a failure — e.g. a
    collapsed or all-failed score_fit makes Spearman ``None``, which must not pass the gate.
    (Only metrics listed in ``thresholds`` are required; other absent metrics are ignored.)"""
    if report.get("status") != "ok":
        return []
    flat = _flatten(report)
    failures: list[str] = []
    for metric, minimum in thresholds.items():
        value = flat.get(metric)
        if value is None:
            failures.append(f"{metric} is missing/None — cannot verify >= {minimum}")
            continue
        if value < minimum:
            failures.append(f"{metric}={value} is below threshold {minimum}")
    return failures


def check_regression(
    report: dict[str, Any], baseline: dict[str, float], tol: float = 0.1
) -> list[str]:
    """Return metrics that dropped more than ``tol`` below the stored baseline."""
    if report.get("status") != "ok":
        return []
    flat = _flatten(report)
    regressions: list[str] = []
    for metric, base in baseline.items():
        value = flat.get(metric)
        if value is None or base is None:
            continue
        if value < base - tol:
            regressions.append(f"{metric}={value} regressed vs baseline {base} (tol {tol})")
    return regressions


def load_thresholds() -> dict[str, float]:
    return json.loads((_DIR / "thresholds.json").read_text(encoding="utf-8"))


def load_baseline() -> dict[str, float]:
    return json.loads((_DIR / "baseline.json").read_text(encoding="utf-8"))

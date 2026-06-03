"""Compose pandas analysis with an LLM narration into TelemetryInsights.

Narration is best-effort: when no LLM provider is configured we return a
deterministic narrative so the endpoint still works offline.
"""

from __future__ import annotations

import logging

from app.llm.provider import get_model, llm_available
from app.prompts import TELEMETRY_NARRATION_SYSTEM
from app.schemas import TelemetryInsights, TelemetryNarrationLLM
from app.telemetry.analyzer import analyze_series, build_ev_demo_series

logger = logging.getLogger("jobops.agent.telemetry")


def _narrate(metric: str, analysis: dict, domain_hint: str) -> tuple[str, list[str], bool]:
    if not llm_available():
        narrative = (
            f"{metric}: total {analysis['total']:.0f}, 7-point average "
            f"{analysis['moving_average_7d']:.1f}, trend {analysis['trend']}. "
            f"{len(analysis['anomaly_labels'])} anomaly point(s) detected."
        )
        recs = ["Connect an LLM provider for richer, narrated insights."]
        return narrative, recs, False

    try:
        model, _ = get_model()
        structured = model.with_structured_output(TelemetryNarrationLLM)
        human = (
            f"Domain: {domain_hint}\n"
            f"Metric: {metric}\n"
            f"Total: {analysis['total']:.2f}\n"
            f"Trend: {analysis['trend']} (slope {analysis['slope']:.3f})\n"
            f"7-point moving average: {analysis['moving_average_7d']:.2f}\n"
            f"Anomaly points: {analysis['anomaly_labels'] or 'none'}\n"
            f"Forecast (next point): {analysis['forecast_next']:.2f}"
        )
        result = structured.invoke([("system", TELEMETRY_NARRATION_SYSTEM), ("human", human)])
        return result.narrative, result.recommendations, True
    except Exception:  # noqa: BLE001 - narration is best-effort
        logger.exception("telemetry narration failed; using deterministic narrative")
        return f"{metric} trend is {analysis['trend']}.", [], False


def insights_from_values(
    metric: str,
    labels: list[str],
    values: list[float],
    domain_hint: str,
) -> TelemetryInsights:
    analysis = analyze_series(values, labels)
    narrative, recommendations, llm_used = _narrate(metric, analysis, domain_hint)
    return TelemetryInsights(
        metric=metric,
        total=analysis["total"],
        trend=analysis["trend"],
        moving_average_7d=analysis["moving_average_7d"],
        anomaly_dates=analysis["anomaly_labels"],
        forecast_next=analysis["forecast_next"],
        narrative=narrative,
        recommendations=recommendations,
        series_labels=labels,
        series_values=[float(v) for v in values],
        llm_used=llm_used,
    )


def pipeline_insights(series) -> TelemetryInsights:
    """Analyze the 'discovered per day' signal of the job-search pipeline."""
    labels = [point.date for point in series]
    values = [float(point.discovered) for point in series]
    return insights_from_values(
        "jobs_discovered_per_day", labels, values, domain_hint="job-search pipeline activity"
    )


def ev_demo_insights() -> TelemetryInsights:
    demo = build_ev_demo_series()
    return insights_from_values(
        demo["metric"],
        demo["labels"],
        demo["values"],
        domain_hint="electric-vehicle battery telemetry (predictive maintenance)",
    )

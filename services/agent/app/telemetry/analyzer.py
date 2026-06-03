"""Time-series analysis with pandas/numpy.

Domain-agnostic: the same routine analyzes job-pipeline activity and the
synthetic EV battery-telemetry demo, demonstrating that the pattern-recognition
approach transfers directly to vehicle sensor data.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# z-score threshold above which a point is flagged as an anomaly
ANOMALY_Z = 2.0


def analyze_series(values: list[float], labels: list[str] | None = None) -> dict:
    """Compute trend, 7-window moving average, anomalies, and a naive forecast.

    Returns plain Python types so the result is JSON-serialisable.
    """
    n = len(values)
    labels = labels or [str(i) for i in range(n)]
    if n == 0:
        return {
            "total": 0.0,
            "trend": "flat",
            "slope": 0.0,
            "moving_average_7d": 0.0,
            "anomaly_indices": [],
            "anomaly_labels": [],
            "forecast_next": 0.0,
        }

    series = pd.Series(values, dtype="float64")
    total = float(series.sum())
    window = min(7, n)
    moving_average = float(series.rolling(window=window, min_periods=1).mean().iloc[-1])

    slope = float(np.polyfit(np.arange(n), series.to_numpy(), 1)[0]) if n >= 2 else 0.0
    trend = "rising" if slope > 0.05 else "falling" if slope < -0.05 else "flat"

    mean = float(series.mean())
    std = float(series.std(ddof=0))
    anomaly_indices: list[int] = []
    if std > 0:
        z_scores = (series - mean) / std
        anomaly_indices = [int(i) for i, z in enumerate(z_scores) if abs(z) >= ANOMALY_Z]

    forecast_next = max(0.0, moving_average + slope)

    return {
        "total": total,
        "trend": trend,
        "slope": slope,
        "moving_average_7d": moving_average,
        "anomaly_indices": anomaly_indices,
        "anomaly_labels": [labels[i] for i in anomaly_indices],
        "forecast_next": forecast_next,
    }


def build_ev_demo_series(points: int = 30, seed: int = 7) -> dict:
    """Synthesize an EV battery state-of-health time-series with a gentle
    degradation trend and an injected anomaly dip. Mirrors the kind of vehicle
    telemetry Pebble works with, to show the analysis transfers."""
    rng = np.random.default_rng(seed)
    base = 100.0 - np.linspace(0, 6, points)  # slow degradation from 100%
    noise = rng.normal(0, 0.4, points)
    values = base + noise
    # inject an anomalous dip (e.g., a faulty cell reading)
    spike_index = points // 2
    values[spike_index] -= 8.0
    labels = [f"t-{points - i}" for i in range(points)]
    return {
        "metric": "battery_state_of_health_pct",
        "labels": labels,
        "values": [round(float(v), 2) for v in values],
    }

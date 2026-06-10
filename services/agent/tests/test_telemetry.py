"""Telemetry analyzer + endpoint tests (no LLM needed; CI-safe)."""

from fastapi.testclient import TestClient

import app.main as main
from app.telemetry.analyzer import analyze_series, build_ev_demo_series

client = TestClient(main.app)


def test_analyze_empty_series():
    out = analyze_series([])
    assert out["trend"] == "flat"
    assert out["total"] == 0.0
    assert out["anomaly_indices"] == []


def test_analyze_detects_rising_trend():
    out = analyze_series([1, 2, 3, 4, 5, 6, 7])
    assert out["trend"] == "rising"
    assert out["total"] == 28.0
    assert out["forecast_next"] >= out["moving_average_7d"]


def test_analyze_detects_anomaly():
    out = analyze_series([1, 1, 1, 1, 50, 1, 1], labels=["a", "b", "c", "d", "e", "f", "g"])
    assert "e" in out["anomaly_labels"]


def test_ev_demo_series_has_injected_anomaly():
    demo = build_ev_demo_series()
    assert demo["metric"] == "battery_state_of_health_pct"
    out = analyze_series(demo["values"], demo["labels"])
    # the injected dip should register as an anomaly and the trend should fall
    assert out["anomaly_labels"]
    assert out["trend"] in {"falling", "flat"}


def test_telemetry_insights_endpoint_without_llm(monkeypatch):
    # llm_available is imported into the insights module
    import app.telemetry.insights as insights

    monkeypatch.setattr(insights, "llm_available", lambda: False)
    res = client.post(
        "/telemetry/insights",
        json={
            "series": [
                {"date": "2026-05-01", "discovered": 2},
                {"date": "2026-05-02", "discovered": 3},
                {"date": "2026-05-03", "discovered": 5},
            ]
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["metric"] == "jobs_discovered_per_day"
    assert body["llm_used"] is False
    assert body["series_values"] == [2.0, 3.0, 5.0]


def test_ev_demo_endpoint(monkeypatch):
    import app.telemetry.insights as insights

    monkeypatch.setattr(insights, "llm_available", lambda: False)
    res = client.get("/telemetry/ev-demo")
    assert res.status_code == 200
    assert res.json()["metric"] == "battery_state_of_health_pct"

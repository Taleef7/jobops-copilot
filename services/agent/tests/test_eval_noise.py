"""Replicate-run noise estimation — no LLM (the scorer is injected).

Two identical-input runs differing by some amount tells you variance of that order
*occurred*; it does not bound the variance. These tests cover the machinery that
turns repeated trials into an actual interval (Codex review on #201).
"""

from __future__ import annotations

import math

import pytest

from evals import noise


def _rows():
    return [{"description_text": "jd", "expected": {"fit_label": 60, "reference": "ref"}}]


# --- spread statistics ------------------------------------------------------


def test_summarize_spread_reports_centre_and_worst_case_pair():
    summary = noise.summarize_spread([0.70, 0.80, 0.75])

    assert summary["n"] == 3
    assert summary["mean"] == pytest.approx(0.75)
    assert summary["min"] == pytest.approx(0.70)
    assert summary["max"] == pytest.approx(0.80)
    # Sample (n-1) standard deviation, not population.
    assert summary["stdev"] == pytest.approx(0.05)
    # The widest gap between any two replicates — directly comparable to a
    # between-mode delta, which is what the report actually needs.
    assert summary["max_pairwise_delta"] == pytest.approx(0.10)


def test_summarize_spread_needs_two_points_for_a_deviation():
    summary = noise.summarize_spread([0.5])
    assert summary["n"] == 1
    assert summary["mean"] == pytest.approx(0.5)
    assert summary["stdev"] is None  # undefined for a single sample
    assert summary["max_pairwise_delta"] == pytest.approx(0.0)


def test_summarize_spread_ignores_missing_metrics():
    """A Ragas metric can come back ``None``; it must not poison the statistics."""
    summary = noise.summarize_spread([0.4, None, 0.6])
    assert summary["n"] == 2
    assert summary["mean"] == pytest.approx(0.5)
    assert summary["max_pairwise_delta"] == pytest.approx(0.2)


def test_summarize_spread_with_no_values_is_empty_not_an_error():
    summary = noise.summarize_spread([None, None])
    assert summary["n"] == 0
    assert summary["mean"] is None
    assert summary["stdev"] is None


# --- the replication driver -------------------------------------------------


def test_run_replicates_scores_the_same_configuration_repeatedly():
    calls = []
    scores = iter([0.70, 0.76, 0.73])

    def fake_score(rows, resume_text, evidence_for):
        calls.append(evidence_for(rows[0]))
        return {
            "n": 1,
            "errors": 0,
            "rank_correlation_spearman": next(scores),
            "ragas": {"faithfulness": 0.8},
        }

    report = noise.run_replicates(
        _rows(),
        "resume",
        replicates=3,
        retrieve_evidence=lambda *a, **k: ["chunk"],
        score_eval=fake_score,
    )

    assert len(calls) == 3
    # Every replicate must see byte-identical evidence, or it is not a noise measurement.
    assert len({(e.resume_text, e.retrieved_context) for e in calls}) == 1

    spearman = report["spread"]["rank_correlation_spearman"]
    assert spearman["n"] == 3
    assert spearman["max_pairwise_delta"] == pytest.approx(0.06)
    assert report["spread"]["faithfulness"]["max_pairwise_delta"] == pytest.approx(0.0)
    assert report["replicates"] == 3
    assert report["runs"][0]["rank_correlation_spearman"] == pytest.approx(0.70)


def test_run_replicates_rejects_fewer_than_two():
    """One run has no spread; asking for it is a mistake worth surfacing loudly."""
    with pytest.raises(ValueError, match="at least 2"):
        noise.run_replicates(_rows(), "resume", replicates=1)


def test_run_replicates_restores_retrieval_settings():
    from app.config import settings

    before = (settings.rag_retrieval_mode, settings.rag_rerank_enabled)
    noise.run_replicates(
        _rows(),
        "resume",
        replicates=2,
        retrieve_evidence=lambda *a, **k: ["chunk"],
        score_eval=lambda rows, resume_text, evidence_for: {
            "rank_correlation_spearman": 0.5,
            "ragas": {},
        },
    )
    assert (settings.rag_retrieval_mode, settings.rag_rerank_enabled) == before


def test_render_noise_markdown_reports_the_interval():
    report = {
        "generated_at": "2026-07-23T00:00:00+00:00",
        "status": "ok",
        "provider": "openai:gpt-4o-mini",
        "mode": "vector",
        "replicates": 3,
        "runs": [],
        "spread": {
            "rank_correlation_spearman": {
                "n": 3,
                "mean": 0.75,
                "stdev": 0.05,
                "min": 0.7,
                "max": 0.8,
                "max_pairwise_delta": 0.1,
            }
        },
    }
    md = noise.render_noise_markdown(report)
    assert "vector" in md and "3" in md
    assert "0.1" in md  # the worst-case pair is what a reader compares against


def test_render_noise_markdown_handles_skipped():
    md = noise.render_noise_markdown(
        {
            "generated_at": "x",
            "status": "skipped",
            "skipped_reason": "no provider key configured",
            "provider": None,
        }
    )
    assert "Skipped" in md


def test_stdev_is_the_sample_not_population_deviation():
    """Guard the n-1 choice explicitly: population stdev here would be 1.118."""
    values = [1.0, 2.0, 3.0, 4.0]
    sample = math.sqrt(sum((v - 2.5) ** 2 for v in values) / 3)  # 1.2910
    population = math.sqrt(sum((v - 2.5) ** 2 for v in values) / 4)  # 1.1180

    # Reported values are rounded to 4dp for readability, so compare at that precision.
    stdev = noise.summarize_spread(values)["stdev"]
    assert stdev == pytest.approx(sample, abs=5e-4)
    assert stdev != pytest.approx(population, abs=5e-4)

"""Structured-output resilience for score-fit (#199).

The issue described "an out-of-range fit_score propagates unclamped". It doesn't --
``FitScoreLLM`` already carries ``ge=0, le=100``, so pydantic *rejects* it. The real
failure mode is worse and less obvious: a model that answers 105 raises a
``ValidationError`` and fails the entire request, turning a near-miss answer into a 500.

So: accept the model's intent and bound it, and retry once when the output is genuinely
unusable. No LLM here -- the model is injected.
"""

from __future__ import annotations

import pytest

from app.chains import score_fit as score_fit_module
from app.schemas import ScoreFitRequest


def _request() -> ScoreFitRequest:
    return ScoreFitRequest(
        description_text="Senior Python engineer, Django and Postgres.",
        resume_text="Built Django services on Postgres.",
        profile_text="",
    )


class _FakeStructured:
    """Stands in for ``model.with_structured_output(...)``."""

    def __init__(self, outcomes):
        self._outcomes = list(outcomes)
        self.calls = 0

    def invoke(self, _messages, config=None):
        self.calls += 1
        outcome = self._outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class _FakeModel:
    def __init__(self, structured):
        self._structured = structured

    def with_structured_output(self, _schema):
        return self._structured


def _install(monkeypatch, outcomes):
    structured = _FakeStructured(outcomes)
    monkeypatch.setattr(
        score_fit_module, "get_model", lambda: (_FakeModel(structured), "fake:model")
    )
    return structured


def _payload(**overrides) -> dict:
    base = {
        "fit_score": 70,
        "matched_skills": ["Python"],
        "missing_skills": [],
        "ats_keywords": [],
        "fit_summary": "Good overlap.",
        "recommended_resume_angle": "",
        "apply_recommendation": "apply",
        "confidence_score": 60,
    }
    base.update(overrides)
    return base


# --- clamping ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [(105, 100), (150, 100), (-5, 0), (100, 100), (0, 0), (70, 70)],
)
def test_out_of_range_fit_score_is_clamped_not_fatal(monkeypatch, raw, expected):
    _install(monkeypatch, [_payload(fit_score=raw)])

    result = score_fit_module.score_fit(_request())

    assert result.fit_score == expected


def test_out_of_range_confidence_is_clamped(monkeypatch):
    _install(monkeypatch, [_payload(confidence_score=120)])
    assert score_fit_module.score_fit(_request()).confidence_score == 100


def test_in_range_values_are_untouched(monkeypatch):
    _install(monkeypatch, [_payload(fit_score=43, confidence_score=17)])

    result = score_fit_module.score_fit(_request())

    assert (result.fit_score, result.confidence_score) == (43, 17)
    assert result.fit_summary == "Good overlap."
    assert result.model_used == "fake:model"


# --- retry ------------------------------------------------------------------


def test_a_malformed_response_is_retried_once(monkeypatch):
    structured = _install(monkeypatch, [ValueError("could not parse tool call"), _payload()])

    result = score_fit_module.score_fit(_request())

    assert structured.calls == 2
    assert result.fit_score == 70


def test_the_retry_is_bounded(monkeypatch):
    """Two consecutive failures propagate — no unbounded retry loop on a broken model."""
    structured = _install(monkeypatch, [ValueError("bad output"), ValueError("bad output again")])

    with pytest.raises(ValueError):
        score_fit_module.score_fit(_request())

    assert structured.calls == 2


def test_a_successful_first_call_is_not_retried(monkeypatch):
    structured = _install(monkeypatch, [_payload()])

    score_fit_module.score_fit(_request())

    assert structured.calls == 1

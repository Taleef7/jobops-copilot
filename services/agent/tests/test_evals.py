"""Unit tests for the eval harness metrics (deterministic, no LLM/network)."""

from evals.metrics.extraction import exact_match, skill_prf


def test_skill_prf_perfect():
    p, r, f = skill_prf(["python", "rag"], ["RAG", "Python"])  # case-insensitive
    assert (p, r, f) == (1.0, 1.0, 1.0)


def test_skill_prf_partial_overlap():
    # predicted {python, java}; gold {python, rag} -> tp=1
    p, r, f = skill_prf(["Python", "Java"], ["python", "RAG"])
    assert p == 0.5
    assert r == 0.5
    assert f == 0.5


def test_skill_prf_empty_prediction_against_gold():
    p, r, f = skill_prf([], ["python"])
    assert (p, r, f) == (0.0, 0.0, 0.0)


def test_skill_prf_both_empty_is_perfect():
    assert skill_prf([], []) == (1.0, 1.0, 1.0)


def test_skill_prf_dedupes_and_ignores_blanks():
    p, r, f = skill_prf(["Python", "python", "  "], ["PYTHON"])
    assert (p, r, f) == (1.0, 1.0, 1.0)


def test_exact_match():
    assert exact_match("Senior", "senior") == 1.0


def test_exact_match_mismatch_and_none():
    assert exact_match("junior", "senior") == 0.0
    assert exact_match(None, "senior") == 0.0
    assert exact_match("  Lead ", "lead") == 1.0

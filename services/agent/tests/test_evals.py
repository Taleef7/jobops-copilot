"""Unit tests for the eval harness metrics (deterministic, no LLM/network)."""

from evals.metrics.extraction import exact_match, skill_prf
from evals.metrics.ragas_fit import mean, spearman


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


def test_spearman_perfect_positive():
    assert spearman([1, 2, 3, 4], [10, 20, 30, 40]) == 1.0


def test_spearman_perfect_negative():
    assert spearman([1, 2, 3, 4], [40, 30, 20, 10]) == -1.0


def test_spearman_handles_ties():
    # predicted ties on the middle two; still strongly positive, not an error
    value = spearman([1, 2, 2, 4], [10, 20, 30, 40])
    assert value is not None and 0.7 < value < 1.0


def test_spearman_too_few_points():
    assert spearman([1], [2]) is None


def test_spearman_length_mismatch():
    assert spearman([1, 2, 3], [1, 2]) is None


def test_spearman_zero_variance_is_none():
    assert spearman([5, 5, 5], [1, 2, 3]) is None


def test_mean_ignores_none_and_rounds():
    assert mean([1.0, 2.0, None]) == 1.5
    assert mean([None, None]) is None
    assert mean([]) is None


def test_parse_job_eval_counts_failures_as_zero(monkeypatch):
    """A failed parse_job row scores 0 on every metric (not silently dropped)."""
    from evals import run

    def boom(_text):
        raise RuntimeError("provider down")

    monkeypatch.setattr(run, "parse_job", boom)
    row = {
        "description_text": "x",
        "expected": {"required_skills": ["python"], "title": "Dev", "seniority": "mid"},
    }
    result = run.run_parse_job_eval([row])
    assert result["n"] == 1
    assert result["errors"] == 1
    assert result["skill_f1"] == 0.0
    assert result["title_accuracy"] == 0.0
    assert result["seniority_accuracy"] == 0.0


def test_fit_score_eval_counts_failures(monkeypatch):
    """Failed score_fit rows are counted and don't crash the run (no Ragas judge)."""
    from evals import run

    def boom(_request):
        raise RuntimeError("provider down")

    monkeypatch.setattr(run, "score_fit", boom)
    rows = [
        {"description_text": "a", "expected": {"fit_label": 80, "reference": "r"}},
        {"description_text": "b", "expected": {"fit_label": 10, "reference": "r"}},
    ]
    result = run.run_fit_score_eval(rows, "resume text")
    assert result["n"] == 2
    assert result["errors"] == 2
    assert result["ragas"] == {}  # no responses to judge


def test_provider_ready_requires_the_selected_key(monkeypatch):
    """An explicit LLM_PROVIDER with a blank key is NOT ready (would otherwise
    fall through to a failing LLM call instead of skipping)."""
    from evals import run

    monkeypatch.setattr(run.settings, "llm_provider", "openai")
    monkeypatch.setattr(run.settings, "openai_api_key", "")
    assert run._provider_ready() is False

    monkeypatch.setattr(run.settings, "openai_api_key", "sk-present")
    assert run._provider_ready() is True


def test_provider_ready_azure_needs_endpoint(monkeypatch):
    """Azure with a key but no endpoint is not ready (would fail at call time)."""
    from evals import run

    monkeypatch.setattr(run.settings, "llm_provider", "azure_openai")
    monkeypatch.setattr(run.settings, "azure_openai_api_key", "key")
    monkeypatch.setattr(run.settings, "azure_openai_endpoint", "")
    assert run._provider_ready() is False

    monkeypatch.setattr(run.settings, "azure_openai_endpoint", "https://x.openai.azure.com")
    assert run._provider_ready() is True


def test_run_skips_without_provider_key(tmp_path, monkeypatch):
    """No provider key -> run skips, writes a report, exits 0 (no LLM calls)."""
    import json

    from evals import run

    monkeypatch.setattr(run, "resolve_provider", lambda: None)
    code = run.main(output_dir=tmp_path)
    assert code == 0
    report = json.loads((tmp_path / "report.json").read_text(encoding="utf-8"))
    assert report["status"] == "skipped"
    assert report["provider"] is None
    assert (tmp_path / "report.md").exists()

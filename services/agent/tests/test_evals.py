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


# --- J1: key-free PR gate (gold-set integrity + mock-model smoke) ------------


def test_gold_sets_are_well_formed():
    import json

    from evals import run

    for name in ("parse_job.jsonl", "fit_score.jsonl"):
        rows = [
            json.loads(line)
            for line in (run._DATA_DIR / name).read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        assert rows, f"{name} is empty"
        for row in rows:
            assert {"description_text", "expected"} <= set(row.keys())
            assert row["description_text"].strip()
    assert (run._DATA_DIR / "sample_resume.txt").read_text(encoding="utf-8").strip()


def test_parse_job_eval_smoke_with_fake_model(monkeypatch):
    """The runner pipeline executes end-to-end with a fake model — no key, no network."""
    from app.schemas import ParsedJob
    from evals import run

    monkeypatch.setattr(
        run, "parse_job", lambda text, config=None: ParsedJob(title="X", required_skills=["python"])
    )
    row = {
        "description_text": "d",
        "expected": {"required_skills": ["python"], "title": "X", "seniority": "mid"},
    }
    out = run.run_parse_job_eval([row])
    assert out["n"] == 1 and out["errors"] == 0 and out["skill_f1"] == 1.0


# --- J2: gate logic (pure) ---------------------------------------------------


def test_check_thresholds_reports_failures():
    from evals.gate import check_thresholds

    report = {
        "status": "ok",
        "parse_job": {"skill_f1": 0.40, "title_accuracy": 0.9, "seniority_accuracy": 0.9},
        "fit_score": {"rank_correlation_spearman": 0.7},
    }
    failures = check_thresholds(report, {"skill_f1": 0.50, "title_accuracy": 0.65})
    assert any("skill_f1" in f for f in failures)
    assert not any("title_accuracy" in f for f in failures)


def test_check_thresholds_skips_when_report_skipped():
    from evals.gate import check_thresholds

    assert check_thresholds({"status": "skipped"}, {"skill_f1": 0.99}) == []


def test_check_thresholds_fails_when_thresholded_metric_missing():
    """A thresholded metric absent on an ok run (e.g. Spearman None) is a failure."""
    from evals.gate import check_thresholds

    report = {"status": "ok", "parse_job": {"skill_f1": 0.9}, "fit_score": {"ragas": {}}}
    failures = check_thresholds(report, {"skill_f1": 0.5, "rank_correlation_spearman": 0.45})
    assert any("rank_correlation_spearman" in f for f in failures)
    assert not any("skill_f1" in f for f in failures)


def test_check_regression_flags_drops():
    from evals.gate import check_regression

    report = {"status": "ok", "fit_score": {"ragas": {"faithfulness": 0.50}}}
    assert check_regression(report, {"faithfulness": 0.80}, tol=0.1)
    assert check_regression(report, {"faithfulness": 0.55}, tol=0.1) == []  # within tolerance


# --- J3: --gate exit behavior ------------------------------------------------


def _stub_keyed_run(monkeypatch, parse_metrics, fit_metrics):
    from evals import run

    monkeypatch.setattr(run, "_provider_ready", lambda: True)
    monkeypatch.setattr(run, "get_model", lambda: (object(), "fake:model"))
    monkeypatch.setattr(run, "_load_jsonl", lambda path: [{}])
    monkeypatch.setattr(run, "run_parse_job_eval", lambda rows: parse_metrics)
    monkeypatch.setattr(run, "run_fit_score_eval", lambda rows, resume: fit_metrics)
    return run


def _pj(score: float) -> dict:
    return {
        "n": 1,
        "errors": 0,
        "skill_precision": score,
        "skill_recall": score,
        "skill_f1": score,
        "title_accuracy": score,
        "seniority_accuracy": score,
    }


def test_main_gate_fails_below_threshold(tmp_path, monkeypatch):
    run = _stub_keyed_run(
        monkeypatch,
        _pj(0.10),
        {"n": 1, "errors": 0, "rank_correlation_spearman": 0.10, "ragas": {}},
    )
    assert run.main(output_dir=tmp_path, gate=True) == 1


def test_main_gate_passes_above_threshold(tmp_path, monkeypatch):
    run = _stub_keyed_run(
        monkeypatch,
        _pj(0.90),
        {"n": 1, "errors": 0, "rank_correlation_spearman": 0.90, "ragas": {}},
    )
    assert run.main(output_dir=tmp_path, gate=True) == 0


def test_main_gate_passes_on_skip(tmp_path, monkeypatch):
    from evals import run

    monkeypatch.setattr(run, "resolve_provider", lambda: None)
    assert run.main(output_dir=tmp_path, gate=True) == 0

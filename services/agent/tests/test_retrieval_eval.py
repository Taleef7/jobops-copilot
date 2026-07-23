"""Retrieval-mode sweep tests — no DB/LLM (the retriever + scorer are injected)."""

import pytest

from app.config import settings
from evals import retrieval


def _rows():
    return [
        {"description_text": "python backend role", "expected": {"fit_label": 80, "reference": "r"}}
    ]


def test_run_retrieval_modes_runs_each_mode_and_aggregates():
    fed: dict[str, bool] = {}

    def fake_retrieve(resume_text, jd, k, user_id=None):
        # Reflect the per-mode settings toggles the sweep applies.
        return [f"ctx-{settings.rag_retrieval_mode}:{settings.rag_rerank_enabled}"]

    def fake_score(rows, resume_text, evidence_for):
        evidence = evidence_for(rows[0])
        chunks = evidence.retrieved_context
        fed[chunks[0] if chunks else "EMPTY"] = True
        return {"rank_correlation_spearman": 0.5, "ragas": {"faithfulness": 0.8}}

    result = retrieval.run_retrieval_modes(
        _rows(),
        "resume text",
        modes=("off", "vector", "hybrid", "hybrid+rerank"),
        retrieve_evidence=fake_retrieve,
        score_eval=fake_score,
        fts_ready=lambda: True,
    )

    assert set(result) == {"off", "vector", "hybrid", "hybrid+rerank"}
    for metrics in result.values():
        assert "rank_correlation_spearman" in metrics and "ragas" in metrics
        assert metrics["status"] == "ok"
    # "off" retrieves nothing; the three retrieval modes feed distinct toggled contexts.
    assert "EMPTY" in fed
    assert "ctx-vector:False" in fed
    assert "ctx-hybrid:False" in fed
    assert "ctx-hybrid:True" in fed


def test_run_retrieval_modes_marks_hybrid_na_without_fts():
    result = retrieval.run_retrieval_modes(
        _rows(),
        "resume text",
        modes=("vector", "hybrid", "hybrid+rerank"),
        retrieve_evidence=lambda *a, **k: ["c"],
        score_eval=lambda rows, resume_text, evidence_for: {
            "rank_correlation_spearman": 0.5,
            "ragas": {},
        },
        fts_ready=lambda: False,
    )
    assert result["vector"]["status"] == "ok"  # vector doesn't need FTS
    assert result["hybrid"]["status"] == "n/a"
    assert result["hybrid+rerank"]["status"] == "n/a"


def test_retrieval_main_skips_without_provider(tmp_path, monkeypatch):
    import json

    from evals import run

    monkeypatch.setattr(run, "_provider_ready", lambda: False)
    code = run.retrieval_main(output_dir=tmp_path)
    assert code == 0
    report = json.loads((tmp_path / "retrieval_report.json").read_text(encoding="utf-8"))
    assert report["status"] == "skipped"
    assert report["provider"] is None
    assert (tmp_path / "retrieval_report.md").exists()


def test_retrieval_main_skips_without_database(tmp_path, monkeypatch):
    import json

    from evals import run

    monkeypatch.setattr(run, "_provider_ready", lambda: True)
    monkeypatch.setattr("app.rag.store.rag_available", lambda: False)
    code = run.retrieval_main(output_dir=tmp_path)
    assert code == 0
    report = json.loads((tmp_path / "retrieval_report.json").read_text(encoding="utf-8"))
    assert report["status"] == "skipped"
    assert "database" in report["skipped_reason"]


def test_render_retrieval_markdown_shows_modes_and_na():
    from evals.run import render_retrieval_markdown

    report = {
        "generated_at": "2026-06-18T00:00:00+00:00",
        "status": "ok",
        "provider": "openai:gpt-4o-mini",
        "modes_order": ["off", "vector", "hybrid"],
        "modes": {
            "off": {
                "status": "ok",
                "n": 2,
                "errors": 0,
                "rank_correlation_spearman": 0.5,
                "ragas": {"faithfulness": 0.8, "answer_relevancy": 0.2, "context_recall": 0.4},
            },
            "vector": {
                "status": "ok",
                "n": 2,
                "errors": 0,
                "rank_correlation_spearman": 0.6,
                "ragas": {},
            },
            "hybrid": {"status": "n/a", "reason": "chunk_tsv / embeddings_tsv_idx absent"},
        },
    }
    md = render_retrieval_markdown(report)
    assert "| off |" in md and "0.5" in md
    assert "| vector |" in md and "0.6" in md
    assert "n/a" in md  # hybrid row marked unavailable


def test_run_retrieval_modes_restores_settings():
    before = (settings.rag_retrieval_mode, settings.rag_rerank_enabled)
    retrieval.run_retrieval_modes(
        _rows(),
        "resume text",
        modes=("hybrid+rerank",),
        retrieve_evidence=lambda *a, **k: ["c"],
        score_eval=lambda rows, resume_text, evidence_for: (
            evidence_for(rows[0]),
            {"rank_correlation_spearman": 0.5, "ragas": {}},
        )[1],
        fts_ready=lambda: True,
    )
    assert (settings.rag_retrieval_mode, settings.rag_rerank_enabled) == before


def test_run_retrieval_modes_restores_settings_after_exception():
    before = (settings.rag_retrieval_mode, settings.rag_rerank_enabled)

    def boom(rows, resume_text, evidence_for):
        raise RuntimeError("scorer blew up mid-sweep")

    with pytest.raises(RuntimeError):
        retrieval.run_retrieval_modes(
            _rows(),
            "resume text",
            modes=("hybrid+rerank",),
            retrieve_evidence=lambda *a, **k: ["c"],
            score_eval=boom,
            fts_ready=lambda: True,
        )
    # The finally must restore settings even when the sweep raises.
    assert (settings.rag_retrieval_mode, settings.rag_rerank_enabled) == before


def test_default_evidence_feeds_the_whole_resume(monkeypatch):
    """The default seam (no ``evidence_for``) measures the production prompt.

    It used to pass the resume *twice* -- once as ``resume_text`` and again as
    ``retrieved_context`` -- which is not what ``score_fit`` receives in production.
    Now it carries the resume once, the way the live no-RAG path does.
    """
    from evals import run

    resume = "Para one.\n\nPara two."
    captured = {}

    def fake_score_fit(request):
        captured["resume_text"] = request.resume_text
        captured["contexts"] = list(request.retrieved_context)

        class _Resp:
            fit_score = 50
            fit_summary = "ok"

        return _Resp()

    monkeypatch.setattr(run, "score_fit", fake_score_fit)
    # Keep it hermetic/fast: don't touch the real Ragas judge or provider.
    monkeypatch.setattr(run, "get_model", lambda: (object(), "fake:model"))
    monkeypatch.setattr(run, "fit_ragas_scores", lambda *a, **k: {})
    rows = [{"description_text": "jd", "expected": {"fit_label": 50, "reference": "r"}}]
    run.run_fit_score_eval(rows, resume)  # no evidence_for -> default path
    assert captured["resume_text"] == resume
    assert captured["contexts"] == []

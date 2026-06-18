"""Retrieval-mode sweep tests — no DB/LLM (the retriever + scorer are injected)."""

from app.config import settings
from evals import retrieval


def _rows():
    return [
        {"description_text": "python backend role", "expected": {"fit_label": 80, "reference": "r"}}
    ]


def test_run_retrieval_modes_runs_each_mode_and_aggregates():
    fed: dict[str, bool] = {}

    def fake_retrieve(resume_text, jd, k):
        # Reflect the per-mode settings toggles the sweep applies.
        return [f"ctx-{settings.rag_retrieval_mode}:{settings.rag_rerank_enabled}"]

    def fake_score(rows, resume_text, contexts_for):
        ctx = contexts_for(rows[0])
        fed[ctx[0] if ctx else "EMPTY"] = True
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
    # "off" feeds no evidence; the three retrieval modes feed distinct toggled contexts.
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
        score_eval=lambda rows, resume_text, contexts_for: {
            "rank_correlation_spearman": 0.5,
            "ragas": {},
        },
        fts_ready=lambda: False,
    )
    assert result["vector"]["status"] == "ok"  # vector doesn't need FTS
    assert result["hybrid"]["status"] == "n/a"
    assert result["hybrid+rerank"]["status"] == "n/a"


def test_run_retrieval_modes_restores_settings():
    before = (settings.rag_retrieval_mode, settings.rag_rerank_enabled)
    retrieval.run_retrieval_modes(
        _rows(),
        "resume text",
        modes=("hybrid+rerank",),
        retrieve_evidence=lambda *a, **k: ["c"],
        score_eval=lambda rows, resume_text, contexts_for: (
            contexts_for(rows[0]),
            {"rank_correlation_spearman": 0.5, "ragas": {}},
        )[1],
        fts_ready=lambda: True,
    )
    assert (settings.rag_retrieval_mode, settings.rag_rerank_enabled) == before

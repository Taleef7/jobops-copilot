"""Reranker tests — run without the model or torch (CI-safe via a fake model)."""

from app.rag import rerank as rerank_mod
from app.rag.rerank import rerank


class _FakeModel:
    """Stands in for a CrossEncoder: returns a fixed score per chunk."""

    def __init__(self, scores: dict[str, float]):
        self._scores = scores

    def predict(self, pairs):
        return [self._scores[chunk] for _query, chunk in pairs]


def test_rerank_orders_by_score_and_truncates(monkeypatch):
    model = _FakeModel({"a": 0.1, "b": 0.9, "c": 0.5})
    monkeypatch.setattr(rerank_mod, "_get_model", lambda: model)
    assert rerank("q", ["a", "b", "c"], k=2) == ["b", "c"]


def test_rerank_graceful_when_model_unavailable(monkeypatch):
    def boom():
        raise RuntimeError("no model / no network")

    monkeypatch.setattr(rerank_mod, "_get_model", boom)
    # Any failure returns the first k chunks unchanged (pre-rerank order).
    assert rerank("q", ["a", "b", "c"], k=2) == ["a", "b"]


def test_rerank_empty_returns_empty(monkeypatch):
    assert rerank("q", [], k=3) == []

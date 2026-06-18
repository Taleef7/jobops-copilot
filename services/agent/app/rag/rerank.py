"""CPU cross-encoder reranker for hybrid retrieval (Phase 4 · P).

Re-scores (query, chunk) pairs with a small cross-encoder so the most relevant
candidates from the fused dense+lexical pool float to the top. The model is
loaded lazily and cached (mirrors ``app/rag/embeddings.py``) and ``torch`` is
only imported on first use, so CI stays light. Reranking is best-effort: any
failure returns the pre-rerank order so the request path never breaks.
"""

from __future__ import annotations

import logging
from functools import lru_cache

from app.config import settings

logger = logging.getLogger("jobops.agent.rag")


@lru_cache(maxsize=1)
def _get_model():
    from sentence_transformers import CrossEncoder  # lazy: pulls torch

    return CrossEncoder(settings.rag_rerank_model)


def rerank(query: str, chunks: list[str], k: int) -> list[str]:
    """Re-score (query, chunk) pairs with a CPU cross-encoder; return the top k.

    Any failure (model unavailable, no network, inference error) returns the
    first k chunks unchanged (graceful)."""
    if not chunks:
        return chunks
    try:
        scores = _get_model().predict([(query, chunk) for chunk in chunks])
        ranked = [
            chunk
            for _score, chunk in sorted(
                zip(scores, chunks, strict=False), key=lambda pair: pair[0], reverse=True
            )
        ]
        return ranked[:k]
    except Exception:  # noqa: BLE001 - reranking is best-effort
        logger.warning("Rerank unavailable; returning pre-rerank order", exc_info=True)
        return chunks[:k]

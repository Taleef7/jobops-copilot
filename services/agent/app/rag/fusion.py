"""Reciprocal Rank Fusion for hybrid retrieval (Phase 4 · O).

Pure, dependency-free: fuses several ranked id lists (e.g. a dense pgvector
ranking and a lexical full-text ranking) into one combined ordering.
"""

from __future__ import annotations

from collections.abc import Sequence


def reciprocal_rank_fusion(
    rankings: Sequence[Sequence[str]], top_k: int, k0: int = 60
) -> list[str]:
    """Fuse ranked id lists by Reciprocal Rank Fusion: score(id) = Σ 1/(k0+rank).

    ``top_k`` is required so a caller can never silently truncate to a hidden
    default; production passes the desired fetch size explicitly. ``k0`` damps
    the contribution of low ranks (the standard RRF constant).
    """
    scores: dict[str, float] = {}
    for ranking in rankings:
        seen: set[str] = set()
        for rank, doc_id in enumerate(ranking):
            if doc_id in seen:
                continue
            seen.add(doc_id)
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k0 + rank)
    ordered = sorted(scores, key=lambda d: scores[d], reverse=True)
    return ordered[:top_k]

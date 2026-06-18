"""Retrieval-mode eval (Phase 4 · Q): the downstream fit-score quality delta.

Runs the existing fit-score eval (rank correlation + Ragas) under each retrieval
mode and reports a per-mode comparison:

- ``off``           — no resume evidence (JD only); the true no-retrieval baseline.
- ``vector``        — dense pgvector only.
- ``hybrid``        — dense + Postgres FTS fused via RRF.
- ``hybrid+rerank`` — hybrid pool reranked by the CPU cross-encoder.

The point is *downstream delta*: same gold set, same scorer, only the retrieved
context changes — so we measure what retrieval actually buys the fit score.

Note: ``off`` (and today's default baseline) feed the *whole* resume, while the
retrieval modes feed only top-k chunks. Context-recall can therefore fall even as
faithfulness/precision rise — read all four metrics, not one headline.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence

from app.config import settings
from app.rag.store import retrieve_resume_evidence
from evals.run import run_fit_score_eval

logger = logging.getLogger("jobops.evals")

RETRIEVAL_MODES = ("off", "vector", "hybrid", "hybrid+rerank")

# (rag_retrieval_mode, rag_rerank_enabled) toggles for each evidence-bearing mode.
_MODE_TOGGLES = {
    "vector": ("vector", False),
    "hybrid": ("hybrid", False),
    "hybrid+rerank": ("hybrid", True),
}
_FTS_MODES = ("hybrid", "hybrid+rerank")


def _fts_ready() -> bool:
    """True iff the ``chunk_tsv`` column **and** ``embeddings_tsv_idx`` both exist.

    Without them the O3 fallback silently makes hybrid == vector, so we'd report a
    bogus "no gain". Checking both guards a partial migration (column created but
    the GIN index build interrupted by the table lock)."""
    try:
        from app.rag.store import _connect

        with _connect() as conn, conn.cursor() as cur:
            cur.execute(
                "select 1 from information_schema.columns "
                "where table_name = 'embeddings' and column_name = 'chunk_tsv'"
            )
            has_col = cur.fetchone() is not None
            cur.execute("select 1 from pg_indexes where indexname = 'embeddings_tsv_idx'")
            has_idx = cur.fetchone() is not None
        return has_col and has_idx
    except Exception:  # noqa: BLE001 - inability to verify => treat hybrid as unavailable
        logger.warning("Could not verify FTS readiness; treating hybrid as N/A", exc_info=True)
        return False


def _make_contexts_for(
    mode: str, resume_text: str, k: int, retrieve_evidence: Callable
) -> Callable[[dict], list[str]]:
    """A ``contexts_for(row)`` callable for one retrieval mode."""
    if mode == "off":
        return lambda _row: []  # JD only — the true no-retrieval baseline

    retrieval_mode, rerank = _MODE_TOGGLES[mode]

    def contexts_for(row: dict) -> list[str]:
        # retrieve() takes mode= but rerank is read from settings, so we toggle both
        # here. Safe only because this eval is single-process / non-concurrent (a CLI
        # run); run_retrieval_modes restores the original settings in its finally.
        settings.rag_retrieval_mode = retrieval_mode
        settings.rag_rerank_enabled = rerank
        return retrieve_evidence(resume_text, row["description_text"], k=k)

    return contexts_for


def run_retrieval_modes(
    rows: list[dict],
    resume_text: str,
    modes: Sequence[str] = RETRIEVAL_MODES,
    *,
    k: int = 4,
    retrieve_evidence: Callable = retrieve_resume_evidence,
    score_eval: Callable = run_fit_score_eval,
    fts_ready: Callable[[], bool] = _fts_ready,
) -> dict[str, dict]:
    """Run the fit-score eval under each retrieval mode; return ``{mode: metrics}``.

    Hybrid modes are marked ``status="n/a"`` (not silently reported) when the FTS
    column/index are absent. Mutated retrieval settings are restored afterwards.
    """
    results: dict[str, dict] = {}
    hybrid_ok: bool | None = None  # computed once, lazily
    original = (settings.rag_retrieval_mode, settings.rag_rerank_enabled)
    try:
        for mode in modes:
            if mode in _FTS_MODES:
                if hybrid_ok is None:
                    hybrid_ok = fts_ready()
                if not hybrid_ok:
                    logger.warning("FTS column/index absent; marking %s N/A", mode)
                    results[mode] = {
                        "status": "n/a",
                        "reason": "chunk_tsv / embeddings_tsv_idx absent",
                    }
                    continue
            contexts_for = _make_contexts_for(mode, resume_text, k, retrieve_evidence)
            metrics = score_eval(rows, resume_text, contexts_for=contexts_for)
            metrics["status"] = "ok"
            results[mode] = metrics
    finally:
        settings.rag_retrieval_mode, settings.rag_rerank_enabled = original
    return results

"""Retrieval-mode eval (Phase 4 · Q): the downstream fit-score quality delta.

Runs the existing fit-score eval (rank correlation + Ragas) under each retrieval
mode and reports a per-mode comparison.

**Retrieval ablation** — the resume reaches the generator *only* through retrieval:

- ``off``           — no resume at all (JD only); the true no-retrieval floor.
- ``vector``        — dense pgvector only.
- ``hybrid``        — dense + Postgres FTS fused via RRF.
- ``hybrid+rerank`` — hybrid pool reranked by the CPU cross-encoder.

**Production-path reference** — the whole resume in the prompt, which is what
``score_fit`` actually receives in production:

- ``full-resume``        — whole resume, no retrieved chunks (the no-DB fallback).
- ``full-resume+vector`` — whole resume *plus* top-k chunks (the live RAG path).

Together the two groups answer different questions: the ablation measures what
retrieval buys versus nothing, the reference pair measures what retrieval buys *on
top of* the real product prompt.

The point is *downstream delta*: same gold set, same scorer, only the evidence
changes. Because the judge's contexts are derived from the same ``Evidence`` the
generator received (see ``evals.evidence``), a mode can only look better by actually
grounding the summary better — not by showing the judge more (#197).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Sequence
from pathlib import Path

from app.config import settings
from app.rag.store import retrieve_resume_evidence
from evals.evidence import Evidence
from evals.run import run_fit_score_eval

logger = logging.getLogger("jobops.evals")

RETRIEVAL_MODES = (
    "off",
    "vector",
    "hybrid",
    "hybrid+rerank",
    "full-resume",
    "full-resume+vector",
)

# A sweep ingests the sample resume to retrieve against. Scope those rows to a
# dedicated tenant: unowned (user_id IS NULL) rows are exactly what any
# `retrieve(user_id=None)` caller reads, so an eval run against a shared database
# would otherwise leave the sample resume inside real retrieval's reach.
EVAL_USER_ID = "eval-harness"

# (rag_retrieval_mode, rag_rerank_enabled) toggles for each evidence-bearing mode.
_MODE_TOGGLES = {
    "vector": ("vector", False),
    "hybrid": ("hybrid", False),
    "hybrid+rerank": ("hybrid", True),
    "full-resume+vector": ("vector", False),
}
_FTS_MODES = ("hybrid", "hybrid+rerank")
# Modes that also put the whole resume in the prompt (the production path).
_FULL_RESUME_MODES = ("full-resume", "full-resume+vector")


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


def load_gold_parses(path: Path | None = None) -> dict[str, dict]:
    """``{row id: {"title", "required_skills"}}`` from the hand-labeled parse-job gold set.

    Production retrieves with the fields ``parse_job`` extracted, so the sweep must too --
    otherwise it silently measures the keyword fallback while the product measures parsed
    skills. Reusing the *gold* parse (rather than calling ``parse_job`` per row) keeps the
    sweep deterministic: a live parse would inject extraction variance into a comparison
    whose real deltas are already close to the noise floor.

    14 of the 16 fit-score rows have a gold parse; the other two fall back to keywords.
    """
    path = path or (Path(__file__).parent / "data" / "parse_job.jsonl")
    parsed: dict[str, dict] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        expected = row.get("expected") or {}
        parsed[row["id"]] = {
            "title": expected.get("title"),
            "required_skills": expected.get("required_skills") or None,
        }
    return parsed


def _make_evidence_for(
    mode: str,
    resume_text: str,
    k: int,
    retrieve_evidence: Callable,
    parsed_by_id: dict[str, dict] | None = None,
) -> Callable[[dict], Evidence]:
    """An ``evidence_for(row)`` callable for one mode.

    ``resume_in_prompt`` is what separates the ablation from the production-path
    reference: the ablation withholds the resume so retrieval is the only way the
    model can learn anything about the candidate.
    """
    resume_in_prompt = resume_text if mode in _FULL_RESUME_MODES else ""

    if mode not in _MODE_TOGGLES:  # "off" and "full-resume" retrieve nothing
        return lambda _row: Evidence(resume_text=resume_in_prompt)

    retrieval_mode, rerank = _MODE_TOGGLES[mode]

    def evidence_for(row: dict) -> Evidence:
        # retrieve() takes mode= but rerank is read from settings, so we toggle both
        # here. Safe only because this eval is single-process / non-concurrent (a CLI
        # run); run_retrieval_modes restores the original settings in its finally.
        settings.rag_retrieval_mode = retrieval_mode
        settings.rag_rerank_enabled = rerank
        parsed = (parsed_by_id or {}).get(row.get("id"), {})
        chunks = retrieve_evidence(
            resume_text,
            row["description_text"],
            k=k,
            user_id=EVAL_USER_ID,
            required_skills=parsed.get("required_skills"),
            title=parsed.get("title"),
        )
        return Evidence(resume_text=resume_in_prompt, retrieved_context=tuple(chunks))

    return evidence_for


def run_retrieval_modes(
    rows: list[dict],
    resume_text: str,
    modes: Sequence[str] = RETRIEVAL_MODES,
    *,
    k: int = 4,
    retrieve_evidence: Callable = retrieve_resume_evidence,
    score_eval: Callable = run_fit_score_eval,
    fts_ready: Callable[[], bool] = _fts_ready,
    parsed_by_id: dict[str, dict] | None = None,
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
            evidence_for = _make_evidence_for(
                mode, resume_text, k, retrieve_evidence, parsed_by_id
            )
            metrics = score_eval(rows, resume_text, evidence_for=evidence_for)
            metrics["status"] = "ok"
            results[mode] = metrics
    finally:
        settings.rag_retrieval_mode, settings.rag_rerank_enabled = original
    return results

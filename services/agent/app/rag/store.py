"""pgvector-backed vector store.

Uses ``%s::vector`` string-literal casts so only ``psycopg`` is required (no
extra adapter dependency). All DB imports are lazy so the module imports
cleanly in CI without psycopg installed and without a database configured.
"""

from __future__ import annotations

import hashlib
import logging
import uuid

from app.config import settings
from app.obs import traced_span
from app.rag.chunk import chunk_text
from app.rag.embeddings import embed_query, embed_texts
from app.rag.fusion import reciprocal_rank_fusion

logger = logging.getLogger("jobops.agent.rag")


def rag_available() -> bool:
    return bool(settings.database_url)


def resume_source_id(resume_text: str) -> str:
    """Stable id for a resume so re-scoring the same resume is idempotent."""
    return "resume-" + hashlib.sha1(resume_text.encode("utf-8")).hexdigest()[:16]


def _connect():
    import psycopg  # lazy

    return psycopg.connect(settings.database_url, connect_timeout=10)


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.6f}" for value in vector) + "]"


def ingest_document(
    source_type: str,
    source_id: str,
    text: str,
    user_id: str | None = None,
) -> int:
    """Chunk, embed, and upsert a document's embeddings. Returns chunk count.

    Embeddings are scoped to ``user_id`` so one user's resume can never ground
    another user's retrieval.
    """
    chunks = chunk_text(text)
    if not chunks:
        return 0

    vectors = embed_texts(chunks)
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            "delete from embeddings "
            "where source_type = %s and source_id = %s and user_id is not distinct from %s",
            (source_type, source_id, user_id),
        )
        for index, (chunk, vector) in enumerate(zip(chunks, vectors, strict=False)):
            cur.execute(
                "insert into embeddings "
                "(id, user_id, source_type, source_id, chunk_index, chunk_text, embedding) "
                "values (%s, %s, %s, %s, %s, %s, %s::vector)",
                (
                    str(uuid.uuid4()),
                    user_id,
                    source_type,
                    source_id,
                    index,
                    chunk,
                    _vector_literal(vector),
                ),
            )
        conn.commit()
    return len(chunks)


def _dense_candidates(
    cur, query_literal: str, n: int, where_sql: str, where_params: list[object]
) -> list[tuple[str, str]]:
    """Top-``n`` (id, chunk_text) by cosine distance (the pgvector dense side)."""
    sql = (
        f"select id, chunk_text from embeddings {where_sql} "
        "order by embedding <=> %s::vector limit %s"
    )
    cur.execute(sql, [*where_params, query_literal, n])
    return cur.fetchall()


def _lexical_candidates(
    cur, query: str, n: int, where_sql: str, where_params: list[object]
) -> list[tuple[str, str]]:
    """Top-``n`` (id, chunk_text) by full-text rank (the Postgres FTS lexical side).

    Raises if the ``chunk_tsv`` column is absent (caller falls back to dense). An
    all-stopword / unparseable query yields an *empty* tsquery that matches zero
    rows **without** raising -- that is expected, and RRF simply degrades to the
    dense ranking; only real errors trigger the vector fallback.
    """
    fts_match = "chunk_tsv @@ websearch_to_tsquery('english', %s)"
    where = (where_sql + " and " + fts_match) if where_sql else ("where " + fts_match)
    sql = (
        f"select id, chunk_text from embeddings {where} "
        "order by ts_rank_cd(chunk_tsv, websearch_to_tsquery('english', %s)) desc limit %s"
    )
    cur.execute(sql, [*where_params, query, query, n])
    return cur.fetchall()


def retrieve(
    query: str,
    k: int = 4,
    source_type: str | None = None,
    source_id: str | None = None,
    user_id: str | None = None,
    mode: str | None = None,
) -> list[str]:
    """Return the ``k`` chunk texts most relevant to ``query``.

    ``mode`` (default ``settings.rag_retrieval_mode``): ``"vector"`` uses dense
    cosine similarity only; ``"hybrid"`` pulls a candidate pool from the dense and
    lexical (FTS) sides and fuses them with Reciprocal Rank Fusion, falling back to
    vector-only if the lexical query fails (e.g. the ``chunk_tsv`` column is absent).

    When ``settings.rag_rerank_enabled`` is set, a larger pool is fetched and a CPU
    cross-encoder reranks it down to ``k`` (best-effort; pre-rerank order on failure).
    """
    mode = mode or settings.rag_retrieval_mode
    # When reranking, fetch a real pool so the reranker has candidates to reorder;
    # otherwise return exactly k. (max() guards a pool smaller than k.)
    fetch_k = max(k, settings.rag_candidate_pool) if settings.rag_rerank_enabled else k
    with traced_span(
        "rag.retrieve", query=query[:200], k=k, mode=mode, source_type=source_type
    ) as span:
        query_literal = _vector_literal(embed_query(query))

        conditions: list[str] = []
        params: list[object] = []
        if source_type:
            conditions.append("source_type = %s")
            params.append(source_type)
        if source_id:
            conditions.append("source_id = %s")
            params.append(source_id)
        if user_id is not None:
            conditions.append("user_id = %s")
            params.append(user_id)
        where_sql = ("where " + " and ".join(conditions)) if conditions else ""

        with _connect() as conn, conn.cursor() as cur:
            if mode == "hybrid":
                pool = settings.rag_candidate_pool
                dense = _dense_candidates(cur, query_literal, pool, where_sql, params)
                texts = {row[0]: row[1] for row in dense}
                try:
                    lexical = _lexical_candidates(cur, query, pool, where_sql, params)
                    for row in lexical:
                        texts.setdefault(row[0], row[1])
                    fused = reciprocal_rank_fusion(
                        [[row[0] for row in dense], [row[0] for row in lexical]],
                        top_k=fetch_k,
                    )
                    chunks = [texts[doc_id] for doc_id in fused]
                except Exception:  # noqa: BLE001 - lexical side is best-effort
                    logger.warning(
                        "Lexical retrieval unavailable; falling back to vector-only",
                        exc_info=True,
                    )
                    chunks = [row[1] for row in dense[:fetch_k]]
            else:
                dense = _dense_candidates(cur, query_literal, fetch_k, where_sql, params)
                chunks = [row[1] for row in dense]

        if settings.rag_rerank_enabled:
            from app.rag.rerank import rerank  # lazy: keeps torch out of the import path

            chunks = rerank(query, chunks, k)

        if span is not None:
            span.update(output={"chunk_count": len(chunks)})
        return chunks


def retrieve_resume_evidence(
    resume_text: str,
    job_description: str,
    k: int = 4,
    user_id: str | None = None,
) -> list[str]:
    """Ingest the resume (idempotent) and retrieve the chunks most relevant to
    the job description. Returns [] and logs on any failure so callers can
    proceed without RAG."""
    try:
        source_id = resume_source_id(resume_text)
        ingest_document("resume", source_id, resume_text, user_id=user_id)
        return retrieve(
            job_description, k=k, source_type="resume", source_id=source_id, user_id=user_id
        )
    except Exception:  # noqa: BLE001 - RAG is best-effort augmentation
        logger.exception("resume RAG retrieval failed; continuing without evidence")
        return []

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
from app.rag.chunk import chunk_text
from app.rag.embeddings import embed_query, embed_texts

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


def ingest_document(source_type: str, source_id: str, text: str) -> int:
    """Chunk, embed, and upsert a document's embeddings. Returns chunk count."""
    chunks = chunk_text(text)
    if not chunks:
        return 0

    vectors = embed_texts(chunks)
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            "delete from embeddings where source_type = %s and source_id = %s",
            (source_type, source_id),
        )
        for index, (chunk, vector) in enumerate(zip(chunks, vectors, strict=False)):
            cur.execute(
                "insert into embeddings "
                "(id, source_type, source_id, chunk_index, chunk_text, embedding) "
                "values (%s, %s, %s, %s, %s, %s::vector)",
                (str(uuid.uuid4()), source_type, source_id, index, chunk, _vector_literal(vector)),
            )
        conn.commit()
    return len(chunks)


def retrieve(
    query: str,
    k: int = 4,
    source_type: str | None = None,
    source_id: str | None = None,
) -> list[str]:
    """Return the ``k`` most similar chunk texts (cosine distance)."""
    query_literal = _vector_literal(embed_query(query))

    conditions: list[str] = []
    params: list[object] = []
    if source_type:
        conditions.append("source_type = %s")
        params.append(source_type)
    if source_id:
        conditions.append("source_id = %s")
        params.append(source_id)
    where_sql = ("where " + " and ".join(conditions)) if conditions else ""

    sql = (
        f"select chunk_text from embeddings {where_sql} "
        "order by embedding <=> %s::vector limit %s"
    )
    params.extend([query_literal, k])

    with _connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return [row[0] for row in cur.fetchall()]


def retrieve_resume_evidence(resume_text: str, job_description: str, k: int = 4) -> list[str]:
    """Ingest the resume (idempotent) and retrieve the chunks most relevant to
    the job description. Returns [] and logs on any failure so callers can
    proceed without RAG."""
    try:
        source_id = resume_source_id(resume_text)
        ingest_document("resume", source_id, resume_text)
        return retrieve(job_description, k=k, source_type="resume", source_id=source_id)
    except Exception:  # noqa: BLE001 - RAG is best-effort augmentation
        logger.exception("resume RAG retrieval failed; continuing without evidence")
        return []

"""RAG tests that run without a database or the embedding model (CI-safe)."""

from app.rag import store
from app.rag.chunk import chunk_text


def test_chunk_empty_returns_empty():
    assert chunk_text("") == []
    assert chunk_text("   \n  ") == []


def test_chunk_packs_paragraphs_within_limit():
    text = "Para one.\n\nPara two.\n\nPara three."
    chunks = chunk_text(text, max_chars=1000)
    assert len(chunks) == 1
    assert "Para one." in chunks[0] and "Para three." in chunks[0]


def test_chunk_splits_when_over_limit():
    text = "\n\n".join(f"Paragraph number {i} with some words." for i in range(20))
    chunks = chunk_text(text, max_chars=80)
    assert len(chunks) > 1
    assert all(len(chunk) <= 80 for chunk in chunks)


def test_resume_source_id_is_stable_and_idempotent():
    a = store.resume_source_id("My resume text")
    b = store.resume_source_id("My resume text")
    c = store.resume_source_id("Different text")
    assert a == b
    assert a != c
    assert a.startswith("resume-")


def test_vector_literal_formats_pgvector():
    assert store._vector_literal([0.1, 0.2, 0.3]) == "[0.100000,0.200000,0.300000]"


def test_rag_unavailable_without_database(monkeypatch):
    monkeypatch.setattr(store.settings, "database_url", None)
    assert store.rag_available() is False

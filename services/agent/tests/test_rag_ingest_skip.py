"""Idempotent ingest: don't re-embed a résumé that is already stored (#199).

`retrieve_resume_evidence` calls `ingest_document` on *every* score-fit request, and
`ingest_document` unconditionally re-chunked, re-embedded, DELETEd and re-INSERTed --
even though `source_id` is a content hash, so identical input guarantees identical rows.
That is a full sentence-transformers forward pass plus a delete/insert cycle on the hot
scoring path, for a provably no-op result.

No database and no embedding model here: both are injected.
"""

from __future__ import annotations

import pytest

from app.rag import store
from app.rag.chunk import chunk_text

# Paragraphs long enough that the 600-char packer can't merge them, so the document
# genuinely spans several chunks and "expected count" is a meaningful assertion.
_TEXT = "\n\n".join(f"Paragraph {i}. " + ("filler words here. " * 40) for i in range(3))
_EXPECTED_CHUNKS = len(chunk_text(_TEXT))


class _FakeCursor:
    """Returns ``stored`` chunk texts for the existence probe."""

    def __init__(self, stored: list[str] | None = None):
        self.stored = stored or []
        self.executed: list[str] = []
        self._last_sql = ""

    def execute(self, sql, params=None):
        self.executed.append(sql)
        self._last_sql = sql

    def fetchall(self):
        if "select chunk_text" in self._last_sql.lower():
            return [(text,) for text in self.stored]
        return []

    def fetchone(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeConn:
    def __init__(self, cursor):
        self._cursor = cursor
        self.commits = 0

    def cursor(self):
        return self._cursor

    def commit(self):
        self.commits += 1

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def harness(monkeypatch):
    calls = {"embed": 0}

    def counting_embed(texts):
        calls["embed"] += 1
        return [[0.0] * 384 for _ in texts]

    monkeypatch.setattr(store, "embed_texts", counting_embed)

    def install(stored=None):
        cursor = _FakeCursor(stored)
        conn = _FakeConn(cursor)
        monkeypatch.setattr(store, "_connect", lambda: conn)
        return cursor, conn, calls

    return install


def test_reingesting_identical_content_does_not_embed(harness):
    """The hot path: same résumé, already stored -> no model call, no writes."""
    cursor, _conn, calls = harness(chunk_text(_TEXT))

    count = store.ingest_document("resume", "resume-abc", _TEXT)

    assert calls["embed"] == 0
    assert not any("insert into embeddings" in sql for sql in cursor.executed)
    assert not any("delete from embeddings" in sql for sql in cursor.executed)
    # Still reports the chunk count, so callers can't tell the difference.
    assert count == _EXPECTED_CHUNKS


def test_first_ingest_embeds_and_writes(harness):
    cursor, _conn, calls = harness([])

    count = store.ingest_document("resume", "resume-abc", _TEXT)

    assert calls["embed"] == 1
    assert any("insert into embeddings" in sql for sql in cursor.executed)
    assert count == _EXPECTED_CHUNKS


def test_a_partial_ingest_is_repaired_not_trusted(harness):
    """Stored count != expected count means an interrupted write. Redo it.

    Skipping on mere *existence* would leave a résumé permanently half-indexed.
    """
    cursor, _conn, calls = harness(chunk_text(_TEXT)[:-1])

    count = store.ingest_document("resume", "resume-abc", _TEXT)

    assert calls["embed"] == 1
    assert any("delete from embeddings" in sql for sql in cursor.executed)
    assert count == _EXPECTED_CHUNKS


def test_force_bypasses_the_skip(harness):
    """An escape hatch for re-indexing after a chunker or embedding-model change."""
    cursor, _conn, calls = harness(chunk_text(_TEXT))

    store.ingest_document("resume", "resume-abc", _TEXT, force=True)

    assert calls["embed"] == 1
    assert any("insert into embeddings" in sql for sql in cursor.executed)


def test_changed_content_with_the_same_chunk_count_is_re_ingested(harness):
    """The skip must compare *content*, not just count (#203 review).

    `/rag/ingest` takes a caller-supplied `source_id` — not a content hash — so a caller
    can update a document's text under the same id. If the new text happens to produce
    the same number of chunks, a count-only check would report success while leaving the
    old chunks and embeddings in place, serving stale content indefinitely.
    """
    stale = [chunk.replace("filler", "OUTDATED") for chunk in chunk_text(_TEXT)]
    cursor, _conn, calls = harness(stale)
    assert len(stale) == _EXPECTED_CHUNKS  # same count, different content

    store.ingest_document("kb-article", "caller-supplied-id", _TEXT)

    assert calls["embed"] == 1
    assert any("delete from embeddings" in sql for sql in cursor.executed)
    assert any("insert into embeddings" in sql for sql in cursor.executed)


def test_chunk_order_matters(harness):
    """Reordered chunks are different content; the same set is not the same document."""
    reordered = list(reversed(chunk_text(_TEXT)))
    cursor, _conn, calls = harness(reordered)

    store.ingest_document("resume", "resume-abc", _TEXT)

    assert calls["embed"] == 1


def test_the_existence_check_is_tenant_scoped(harness):
    """Two tenants can hold the same document text; one's rows must not satisfy the other.

    For résumés ``source_id`` hashes the content alone, so without the user_id predicate
    a second tenant would skip ingest and then retrieve nothing.
    """
    cursor, _conn, _calls = harness(chunk_text(_TEXT))

    store.ingest_document("resume", "resume-abc", _TEXT, user_id="u1")

    probe_sql = next(sql for sql in cursor.executed if "select chunk_text" in sql.lower())
    assert "user_id is not distinct from %s" in probe_sql
    assert "source_type" in probe_sql and "source_id" in probe_sql
    assert "order by chunk_index" in probe_sql.lower()


def test_a_failed_check_degrades_to_reindexing(harness, monkeypatch):
    """If the count query blows up, ingest must proceed rather than silently skip."""
    cursor, _conn, calls = harness(chunk_text(_TEXT))
    monkeypatch.setattr(store, "_stored_chunk_texts", lambda *a, **k: [])

    store.ingest_document("resume", "resume-abc", _TEXT)

    assert calls["embed"] == 1


def test_empty_text_still_short_circuits(harness):
    _cursor, _conn, calls = harness([])
    assert store.ingest_document("resume", "resume-abc", "   ") == 0
    assert calls["embed"] == 0

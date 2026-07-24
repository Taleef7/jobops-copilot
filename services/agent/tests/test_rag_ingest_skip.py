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
    def __init__(self, existing_count: int = 0):
        self.existing_count = existing_count
        self.executed: list[str] = []
        self._last_sql = ""

    def execute(self, sql, params=None):
        self.executed.append(sql)
        self._last_sql = sql

    def fetchone(self):
        if "count(" in self._last_sql.lower():
            return (self.existing_count,)
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

    def install(existing_count: int):
        cursor = _FakeCursor(existing_count)
        conn = _FakeConn(cursor)
        monkeypatch.setattr(store, "_connect", lambda: conn)
        return cursor, conn, calls

    return install


def test_reingesting_identical_content_does_not_embed(harness):
    """The hot path: same résumé, already stored -> no model call, no writes."""
    cursor, _conn, calls = harness(existing_count=_EXPECTED_CHUNKS)

    count = store.ingest_document("resume", "resume-abc", _TEXT)

    assert calls["embed"] == 0
    assert not any("insert into embeddings" in sql for sql in cursor.executed)
    assert not any("delete from embeddings" in sql for sql in cursor.executed)
    # Still reports the chunk count, so callers can't tell the difference.
    assert count == _EXPECTED_CHUNKS


def test_first_ingest_embeds_and_writes(harness):
    cursor, _conn, calls = harness(existing_count=0)

    count = store.ingest_document("resume", "resume-abc", _TEXT)

    assert calls["embed"] == 1
    assert any("insert into embeddings" in sql for sql in cursor.executed)
    assert count == _EXPECTED_CHUNKS


def test_a_partial_ingest_is_repaired_not_trusted(harness):
    """Stored count != expected count means an interrupted write. Redo it.

    Skipping on mere *existence* would leave a résumé permanently half-indexed.
    """
    cursor, _conn, calls = harness(existing_count=_EXPECTED_CHUNKS - 1)

    count = store.ingest_document("resume", "resume-abc", _TEXT)

    assert calls["embed"] == 1
    assert any("delete from embeddings" in sql for sql in cursor.executed)
    assert count == _EXPECTED_CHUNKS


def test_force_bypasses_the_skip(harness):
    """An escape hatch for re-indexing after a chunker or embedding-model change."""
    cursor, _conn, calls = harness(existing_count=_EXPECTED_CHUNKS)

    store.ingest_document("resume", "resume-abc", _TEXT, force=True)

    assert calls["embed"] == 1
    assert any("insert into embeddings" in sql for sql in cursor.executed)


def test_the_existence_check_is_tenant_scoped(harness):
    """Two tenants can hold the same résumé text; one's rows must not satisfy the other.

    ``source_id`` hashes the content alone, so without the user_id predicate a second
    tenant would skip ingest and then retrieve nothing.
    """
    cursor, _conn, _calls = harness(existing_count=_EXPECTED_CHUNKS)

    store.ingest_document("resume", "resume-abc", _TEXT, user_id="u1")

    count_sql = next(sql for sql in cursor.executed if "count(" in sql.lower())
    assert "user_id is not distinct from %s" in count_sql
    assert "source_type" in count_sql and "source_id" in count_sql


def test_a_failed_check_degrades_to_reindexing(harness, monkeypatch):
    """If the count query blows up, ingest must proceed rather than silently skip."""
    cursor, _conn, calls = harness(existing_count=_EXPECTED_CHUNKS)
    monkeypatch.setattr(store, "_chunk_count", lambda *a, **k: 0)

    store.ingest_document("resume", "resume-abc", _TEXT)

    assert calls["embed"] == 1


def test_empty_text_still_short_circuits(harness):
    _cursor, _conn, calls = harness(existing_count=0)
    assert store.ingest_document("resume", "resume-abc", "   ") == 0
    assert calls["embed"] == 0

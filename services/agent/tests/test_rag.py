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


# --- hybrid retrieval (Phase 4 · O3) -------------------------------------------------

DENSE_ROWS = [("1", "dense-a"), ("2", "shared-b"), ("3", "shared-c")]
LEXICAL_ROWS = [("2", "shared-b"), ("3", "shared-c"), ("4", "lex-d")]


class _FakeCursor:
    """Records executed SQL and returns canned rows for the dense vs lexical query."""

    def __init__(self, dense_rows, lexical_rows, lexical_error=False):
        self._dense = dense_rows
        self._lexical = lexical_rows
        self._lexical_error = lexical_error
        self.queries: list[str] = []
        self._last: list[tuple[str, str]] = []
        self._limit: int | None = None

    def execute(self, sql, params=None):
        self.queries.append(sql)
        self._limit = params[-1] if params else None  # the trailing `limit %s`
        if "websearch_to_tsquery" in sql:
            if self._lexical_error:
                raise RuntimeError("column chunk_tsv does not exist")
            self._last = self._lexical
        else:
            self._last = self._dense

    def fetchall(self):
        return self._last[: self._limit] if self._limit is not None else self._last

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeConn:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _patch_store(monkeypatch, cursor):
    monkeypatch.setattr(store, "embed_query", lambda _q: [0.0, 0.0, 0.0])
    monkeypatch.setattr(store, "_connect", lambda: _FakeConn(cursor))


def test_hybrid_retrieve_fuses_dense_and_lexical(monkeypatch):
    cursor = _FakeCursor(DENSE_ROWS, LEXICAL_ROWS)
    _patch_store(monkeypatch, cursor)
    # "2"/"3" rank highly in both lists, so RRF surfaces them above the singletons.
    assert store.retrieve("python backend", k=2, mode="hybrid") == ["shared-b", "shared-c"]
    assert any("websearch_to_tsquery" in q for q in cursor.queries)  # lexical side ran


def test_hybrid_falls_back_to_vector_when_lexical_errors(monkeypatch):
    cursor = _FakeCursor(DENSE_ROWS, LEXICAL_ROWS, lexical_error=True)
    _patch_store(monkeypatch, cursor)
    # Missing chunk_tsv column -> lexical raises -> dense top-k returned, no crash.
    assert store.retrieve("python backend", k=2, mode="hybrid") == ["dense-a", "shared-b"]


def test_hybrid_empty_lexical_degrades_to_dense(monkeypatch):
    # Refinement #2: an all-stopword query yields an empty tsquery matching zero rows
    # WITHOUT raising; RRF then degrades to the dense ranking (not the error path).
    cursor = _FakeCursor(DENSE_ROWS, [])
    _patch_store(monkeypatch, cursor)
    assert store.retrieve("the a of", k=2, mode="hybrid") == ["dense-a", "shared-b"]
    assert any("websearch_to_tsquery" in q for q in cursor.queries)  # it ran, didn't error


def test_vector_mode_skips_lexical(monkeypatch):
    cursor = _FakeCursor(DENSE_ROWS, LEXICAL_ROWS)
    _patch_store(monkeypatch, cursor)
    assert store.retrieve("python backend", k=2, mode="vector") == ["dense-a", "shared-b"]
    assert not any("websearch_to_tsquery" in q for q in cursor.queries)  # lexical skipped

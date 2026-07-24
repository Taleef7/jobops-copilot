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
        self.calls: list[tuple[str, list]] = []  # (sql, params) for binding assertions
        self._last: list[tuple[str, str]] = []
        self._limit: int | None = None

    def execute(self, sql, params=None):
        self.queries.append(sql)
        self.calls.append((sql, list(params) if params else []))
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


def test_hybrid_scoping_flows_into_lexical_query(monkeypatch):
    # Highest-stakes guarantee: tenant/source filters must reach the LEXICAL side too,
    # or one user could retrieve another's chunks via full-text search.
    cursor = _FakeCursor(DENSE_ROWS, LEXICAL_ROWS)
    _patch_store(monkeypatch, cursor)
    store.retrieve(
        "python backend",
        k=2,
        mode="hybrid",
        source_type="resume",
        source_id="resume-x",
        user_id="u1",
    )
    lexical_sql, lexical_params = next(
        (sql, params) for sql, params in cursor.calls if "websearch_to_tsquery" in sql
    )
    assert "user_id is not distinct from %s" in lexical_sql
    # Scoping binds precede the two tsquery binds, which precede the limit.
    assert lexical_params[:3] == ["resume", "resume-x", "u1"]
    # The query reaches FTS as quoted, OR-joined terms -- bare text would be ANDed and
    # match nothing (#198). Both tsquery binds get the same text (match + rank).
    assert lexical_params[3] == '"python" or "backend"'
    assert lexical_params[4] == '"python" or "backend"'
    assert lexical_params[-1] == store.settings.rag_candidate_pool  # pool, then RRF to k


def test_retrieve_scopes_to_null_user_when_user_id_missing(monkeypatch):
    # Security (AI-4): user_id=None must scope to unowned rows (IS NULL), never search
    # across all tenants. Mirrors ingest's `is not distinct from` semantics.
    cursor = _FakeCursor(DENSE_ROWS, LEXICAL_ROWS)
    _patch_store(monkeypatch, cursor)
    store.retrieve("python backend", k=2, mode="vector", user_id=None)
    dense_sql, dense_params = next(
        (sql, params) for sql, params in cursor.calls if "websearch_to_tsquery" not in sql
    )
    assert "user_id is not distinct from %s" in dense_sql
    assert None in dense_params  # the None user_id is bound (scoped), not dropped


# --- reranker wiring (Phase 4 · P2) --------------------------------------------------


def test_rerank_enabled_fetches_pool_then_reranks_to_k(monkeypatch):
    import app.rag.rerank as rerank_mod

    cursor = _FakeCursor(DENSE_ROWS, LEXICAL_ROWS)
    _patch_store(monkeypatch, cursor)
    monkeypatch.setattr(store.settings, "rag_rerank_enabled", True)
    monkeypatch.setattr(store.settings, "rag_candidate_pool", 16)

    captured = {}

    def fake_rerank(query, chunks, k):
        captured["pool"] = list(chunks)  # what the reranker actually saw
        return list(reversed(chunks))[:k]

    monkeypatch.setattr(rerank_mod, "rerank", fake_rerank)

    result = store.retrieve("python backend", k=2, mode="vector")
    # Pool, not k: dense was fetched with limit == max(k, pool) == 16 so the reranker
    # gets real candidates (otherwise hybrid/rerank benefit collapses before reranking).
    assert cursor.calls[0][1][-1] == 16
    assert captured["pool"] == ["dense-a", "shared-b", "shared-c"]
    assert result == ["shared-c", "shared-b"]  # reversed top-2


def test_rerank_disabled_fetches_k_and_skips_rerank(monkeypatch):
    import app.rag.rerank as rerank_mod

    cursor = _FakeCursor(DENSE_ROWS, LEXICAL_ROWS)
    _patch_store(monkeypatch, cursor)
    monkeypatch.setattr(store.settings, "rag_rerank_enabled", False)

    def boom(*_a, **_k):
        raise AssertionError("rerank must not be called when disabled")

    monkeypatch.setattr(rerank_mod, "rerank", boom)

    result = store.retrieve("python backend", k=2, mode="vector")
    assert cursor.calls[0][1][-1] == 2  # fetch_k == k
    assert result == ["dense-a", "shared-b"]


def test_rerank_in_hybrid_mode_reranks_the_fused_pool(monkeypatch):
    import app.rag.rerank as rerank_mod

    cursor = _FakeCursor(DENSE_ROWS, LEXICAL_ROWS)
    _patch_store(monkeypatch, cursor)
    monkeypatch.setattr(store.settings, "rag_rerank_enabled", True)
    monkeypatch.setattr(store.settings, "rag_candidate_pool", 16)

    captured = {}

    def fake_rerank(query, chunks, k):
        captured["pool"] = list(chunks)
        return list(reversed(chunks))[:k]

    monkeypatch.setattr(rerank_mod, "rerank", fake_rerank)

    result = store.retrieve("python backend", k=2, mode="hybrid")
    # Both sides pulled with limit == pool (16), then RRF fuses to fetch_k (also 16),
    # so the reranker sees the *fused* candidates, not a dense-only or k-collapsed set.
    assert all(call[1][-1] == 16 for call in cursor.calls)
    assert set(captured["pool"]) == {"dense-a", "shared-b", "shared-c", "lex-d"}
    assert result == list(reversed(captured["pool"]))[:2]


def test_rerank_with_k_larger_than_pool(monkeypatch):
    import app.rag.rerank as rerank_mod

    cursor = _FakeCursor(DENSE_ROWS, LEXICAL_ROWS)
    _patch_store(monkeypatch, cursor)
    monkeypatch.setattr(store.settings, "rag_rerank_enabled", True)
    monkeypatch.setattr(store.settings, "rag_candidate_pool", 4)
    monkeypatch.setattr(rerank_mod, "rerank", lambda _q, chunks, k: chunks[:k])

    # max(k, pool) guard: k=10 > pool=4 -> fetch_k == 10, never below k.
    store.retrieve("python backend", k=10, mode="vector")
    assert cursor.calls[0][1][-1] == 10

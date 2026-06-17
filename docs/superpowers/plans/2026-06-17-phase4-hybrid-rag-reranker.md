# Phase 4: hybrid retrieval, reranker & retrieval eval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Confirm exact APIs (`websearch_to_tsquery`/`ts_rank_cd` on the installed Postgres; `sentence_transformers.CrossEncoder.predict`) via Context7 at the start of the relevant workstream.

**Goal:** Improve RAG retrieval quality with hybrid (dense + lexical) search fused via RRF and a CPU cross-encoder reranker, then measure the gain end-to-end with the existing eval harness — without breaking the no-DB / no-model / no-key degradation guarantees.

**Architecture:** Three sequential sub-issues in `services/agent`. **O**: add a Postgres FTS column + lexical query beside the pgvector dense query and fuse with Reciprocal Rank Fusion. **P**: rerank a larger candidate pool with a `sentence-transformers` CrossEncoder (lazy, CPU). **Q**: a mode sweep over the fit-score gold set comparing off/vector/hybrid/hybrid+rerank. All wired through the existing `app/rag/store.py:retrieve()` so callers are unchanged.

**Tech Stack:** Python 3.12, psycopg + pgvector + Postgres full-text search, sentence-transformers (CrossEncoder), pytest.

**Conventions to follow (existing patterns):**
- `app/rag/store.py` keeps DB imports lazy (`import psycopg` inside `_connect`) and uses `%s::vector` literals; retrieval is user/source-scoped.
- Lazy CPU models via `@lru_cache` (mirror `app/rag/embeddings.py:_get_model`); heavy deps live in `requirements-rag.txt`, imported lazily so CI stays light.
- Config: add fields to `app/config.py` `Settings` (e.g. `rag_retrieval_mode` ← `RAG_RETRIEVAL_MODE`).
- Graceful degradation is sacred: missing DB column / model / key must **fall back**, never raise into retrieval or the request path.
- **Sequencing:** O → P → Q share `app/rag/` + `evals/` — implement in order, each branched off `main` after the previous merges.

---

## File structure

**Workstream O — Hybrid retrieval**
- Create `db/migrations/007_fts.sql` — `tsvector` generated column on `embeddings` + GIN index.
- Create `services/agent/app/rag/fusion.py` — `reciprocal_rank_fusion(rankings, ...)` (pure).
- Modify `services/agent/app/rag/store.py` — `_dense_candidates`, `_lexical_candidates`, hybrid path in `retrieve()` with vector fallback.
- Modify `services/agent/app/config.py` — `rag_retrieval_mode`, `rag_candidate_pool`.
- Create `services/agent/tests/test_fusion.py`; extend `tests/test_rag.py`.

**Workstream P — Reranker**
- Create `services/agent/app/rag/rerank.py` — lazy CrossEncoder + `rerank(query, chunks, k)`.
- Modify `services/agent/app/rag/store.py` — rerank the pool in `retrieve()` when enabled.
- Modify `services/agent/app/config.py` — `rag_rerank_enabled`, `rag_rerank_model`.
- Create `services/agent/tests/test_rerank.py`.

**Workstream Q — Retrieval eval**
- Create `services/agent/evals/retrieval.py` — mode sweep over the fit-score gold set.
- Modify `services/agent/evals/run.py` — `--retrieval-modes` entrypoint.
- Modify `EVALS.md`, `.env.example`, `docs/ARCHITECTURE.md`.
- Create `services/agent/tests/test_retrieval_eval.py`.

---

## Workstream O — Hybrid retrieval

### Task O1: FTS migration + config
**Files:** Create `db/migrations/007_fts.sql`; Modify `services/agent/app/config.py`

- [ ] **Step 0: Confirm API** — via Context7, confirm `to_tsvector`/`websearch_to_tsquery`/`ts_rank_cd` usage and the generated-column syntax on the installed Postgres (pgvector image, PG 16+).
- [ ] **Step 1: Migration** `db/migrations/007_fts.sql`:

```sql
-- Lexical (full-text) side of hybrid retrieval (Phase 4 · O).
alter table embeddings
  add column if not exists chunk_tsv tsvector
  generated always as (to_tsvector('english', chunk_text)) stored;
create index if not exists embeddings_tsv_idx on embeddings using gin (chunk_tsv);
```

- [ ] **Step 2: Apply locally** — `npm run db:init --workspace @jobops/api` (or apply manually) against a dev `DATABASE_URL`. Expected: `\d embeddings` shows `chunk_tsv` + the GIN index.
- [ ] **Step 3: Config** — add to `Settings`:

```python
    # RAG retrieval (Phase 4). mode: "vector" (dense only) or "hybrid" (dense + FTS via RRF).
    rag_retrieval_mode: str = "hybrid"
    rag_candidate_pool: int = 16  # candidates pulled per side before fusion / rerank
```

- [ ] **Step 4: Commit** — `feat(rag): FTS column + index migration + retrieval config`.

### Task O2: Reciprocal Rank Fusion (TDD, pure)
**Files:** Create `app/rag/fusion.py`; Test `tests/test_fusion.py`

- [ ] **Step 1: Failing test**

```python
from app.rag.fusion import reciprocal_rank_fusion

def test_rrf_rewards_agreement_across_rankings():
    dense = ["a", "b", "c"]
    lexical = ["b", "a", "d"]
    # b is high in both -> should rank first; top_k caps the result
    assert reciprocal_rank_fusion([dense, lexical], top_k=3) == ["b", "a", "c"]

def test_rrf_handles_empty_and_dedup():
    assert reciprocal_rank_fusion([[], ["x", "x"]], top_k=2) == ["x"]
```

- [ ] **Step 2: Run — expect FAIL** — `pytest tests/test_fusion.py -v`.
- [ ] **Step 3: Implement** `app/rag/fusion.py`:

```python
from __future__ import annotations
from collections.abc import Sequence

def reciprocal_rank_fusion(rankings: Sequence[Sequence[str]], k0: int = 60, top_k: int = 4) -> list[str]:
    """Fuse ranked id lists by Reciprocal Rank Fusion: score(id)=Σ 1/(k0+rank)."""
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
```

(Verify the expected order in the test against this formula; adjust the test, not the formula, if ties differ.)

- [ ] **Step 4–5: Run PASS; `ruff`. Commit** — `feat(rag): reciprocal rank fusion`.

### Task O3: hybrid retrieve with vector fallback (TDD)
**Files:** Modify `app/rag/store.py`; Test `tests/test_rag.py`

- [ ] **Step 1–2: Failing test** — with a fake `_connect` cursor returning canned `(id, chunk_text)` rows for the dense and lexical SQL, `retrieve(query, k=2, mode="hybrid")` returns the RRF-fused top-2 texts; and when the lexical query raises (simulating a missing `chunk_tsv`), it falls back to the dense top-2. (Patch `store._connect` with a fake context manager; assert SQL routing via the cursor's recorded queries.)
- [ ] **Step 3: Implement** — split the current query into `_dense_candidates(cur, query_literal, pool, where, params)` (order by `embedding <=> %s::vector`) and `_lexical_candidates(cur, query, pool, where, params)` (`where chunk_tsv @@ websearch_to_tsquery('english', %s) order by ts_rank_cd(chunk_tsv, websearch_to_tsquery('english', %s)) desc`), each selecting `id, chunk_text`. `retrieve()` reads `mode = (mode or settings.rag_retrieval_mode)`:
  - `vector`: dense top-k (today's behavior).
  - `hybrid`: pull `rag_candidate_pool` from each side; `texts = {id: chunk_text}`; `fused = reciprocal_rank_fusion([dense_ids, lexical_ids], top_k=k)`; return `[texts[i] for i in fused]`. Wrap the lexical query in try/except → on error, log and return dense top-k.
  - Keep the `traced_span` + user/source filters on both sides.
- [ ] **Step 4–5: Run PASS; `pytest tests/test_rag.py && ruff`. Commit** — `feat(rag): hybrid retrieval (dense + FTS via RRF) with vector fallback`.

---

## Workstream P — Reranker

### Task P1: cross-encoder rerank (TDD, fake model)
**Files:** Create `app/rag/rerank.py`; Modify `app/config.py`; Test `tests/test_rerank.py`

- [ ] **Step 0: Confirm API** — via Context7, confirm `sentence_transformers.CrossEncoder(model).predict([(query, doc), ...])` returns a score per pair (higher = more relevant).
- [ ] **Step 1–2: Failing test** — monkeypatch the lazy model getter with a fake whose `predict` returns fixed scores; `rerank("q", ["a","b","c"], k=2)` returns the 2 highest-scored chunks in score order; and when the model getter raises, `rerank` returns the first `k` unchanged (graceful).
- [ ] **Step 3: Implement** `app/rag/rerank.py`:

```python
from __future__ import annotations
import logging
from functools import lru_cache
from app.config import settings

logger = logging.getLogger("jobops.agent.rag")

@lru_cache(maxsize=1)
def _get_model():
    from sentence_transformers import CrossEncoder  # lazy: pulls torch
    return CrossEncoder(settings.rag_rerank_model)

def rerank(query: str, chunks: list[str], k: int) -> list[str]:
    """Re-score (query, chunk) pairs with a CPU cross-encoder; return the top k.
    Any failure returns the first k chunks unchanged (graceful)."""
    if not chunks:
        return chunks
    try:
        scores = _get_model().predict([(query, chunk) for chunk in chunks])
        ranked = [c for _, c in sorted(zip(scores, chunks, strict=False), key=lambda p: p[0], reverse=True)]
        return ranked[:k]
    except Exception:  # noqa: BLE001 - reranking is best-effort
        logger.warning("Rerank unavailable; returning pre-rerank order", exc_info=True)
        return chunks[:k]
```

Add to `Settings`: `rag_rerank_enabled: bool = True` and `rag_rerank_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"`.

- [ ] **Step 4–5: Run PASS; `ruff`. Commit** — `feat(rag): CPU cross-encoder reranker (graceful)`.

### Task P2: wire rerank into retrieve
**Files:** Modify `app/rag/store.py`; Test `tests/test_rag.py`

- [ ] **Step 1–2: Failing test** — with hybrid stubbed to return a known pool and `rag_rerank_enabled=True`, `retrieve(query, k=2)` calls `rerank` (monkeypatched to reverse the pool) and returns its top-2; with `rag_rerank_enabled=False`, the pool's first 2 are returned unchanged.
- [ ] **Step 3: Implement** — in `retrieve()`, when `settings.rag_rerank_enabled`, retrieve `max(k, rag_candidate_pool)` candidates (hybrid or vector), then `from app.rag.rerank import rerank; return rerank(query, pool, k)`. When disabled, return the pool's top-k as before. Import `rerank` lazily inside the function so CI without torch is unaffected.
- [ ] **Step 4–5: Run PASS; `pytest && ruff check app tests`. Commit** — `feat(rag): rerank the candidate pool in retrieve()`.

---

## Workstream Q — Retrieval eval (downstream delta)

### Task Q1: mode sweep + entrypoint + docs
**Files:** Create `evals/retrieval.py`; Modify `evals/run.py`, `EVALS.md`, `.env.example`, `docs/ARCHITECTURE.md`; Test `tests/test_retrieval_eval.py`

- [ ] **Step 1–2: Failing test** — `run_retrieval_modes(rows, resume_text, modes, deps)` with injected fake `retrieve`/`score_fit`/`ragas` returns a dict keyed by mode, each with `rank_correlation_spearman` + `ragas` metrics; assert it runs every requested mode and aggregates per mode. (No DB/LLM — inject the retriever + scorer.)
- [ ] **Step 3: Implement** `evals/retrieval.py` — for each mode (`off`/`vector`/`hybrid`/`hybrid+rerank`): build each row's `retrieved_context` via the retriever under that mode (`off` → `[]`; others → `retrieve_resume_evidence` with the matching `RAG_RETRIEVAL_MODE`/`RAG_RERANK_ENABLED` toggled), run the existing `run_fit_score_eval` machinery, and collect the metrics. `evals/run.py` gains a `--retrieval-modes` flag that, when a DB + provider are present, runs the sweep and prints/writes a per-mode comparison table (else prints a skip line). Document the modes + a real results table in `EVALS.md`; add `RAG_*` vars to `.env.example` and a RAG paragraph to `ARCHITECTURE.md`.
- [ ] **Step 4–5: Run PASS; `pytest && ruff`; (optionally) a real `python -m evals.run --retrieval-modes` against a keyed dev DB to fill the EVALS.md numbers. Commit** — `feat(evals): retrieval-mode comparison (off/vector/hybrid/+rerank)`.

---

## Self-review (spec coverage)
- **O — hybrid:** O1 (migration + config) · O2 (RRF) · O3 (hybrid retrieve + vector fallback). ✓ (criteria 1)
- **P — reranker:** P1 (cross-encoder, graceful) · P2 (wire into retrieve). ✓ (criteria 2, 4 — no new dep)
- **Q — retrieval eval:** Q1 (mode sweep + entrypoint + EVALS.md). ✓ (criterion 3)
- **Graceful degradation (criterion 5):** vector fallback (O3), pre-rerank fallback (P1), eval skip without DB/key (Q1); RAG already no-ops without a DB.
- **Deferrals honored:** no fine-tuning, no new gold set, no embedding/store swap.

**Note:** exact Postgres FTS function usage and the `CrossEncoder.predict` contract are confirmed against the repo + Context7 at the first task of each workstream; the RRF tie-ordering in the O2 test is verified against the implemented formula before locking the assertion.

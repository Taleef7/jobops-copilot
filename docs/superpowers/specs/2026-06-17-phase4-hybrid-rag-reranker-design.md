# Design — Phase 4: hybrid retrieval, reranker & retrieval eval

**Date:** 2026-06-17
**Status:** Approved (design accepted; scope: hybrid retrieval + cross-encoder reranker + downstream retrieval eval. **Fine-tuning deferred** — infra-constrained. Balanced portfolio-signal / prod-hardening driver.)
**Part of:** the "Production-grade AI" program (epic #43). Phases 1–3 shipped. This spec covers **Phase 4 only**.

## 1. Why

Retrieval quality is the foundation of grounded fit scoring (Phase 10 RAG). Phase 4 raises
it with two standard, well-understood upgrades — **hybrid search** (dense + lexical) and a
**cross-encoder reranker** — and **measures** the gain with the existing eval harness so the
improvement is evidence-based, not assumed. Both drivers weigh equally: credible in the
portfolio (real retrieval engineering) and a real quality lift in the live app.

Fine-tuning (the third deferred item) is intentionally **out of scope**: it needs labeled
training data and GPU training infra the CPU-only Azure-for-Students deployment can't host;
revisit later.

## 2. Goals / non-goals

**Goals**
- **O** — Hybrid retrieval: add Postgres full-text (lexical) search beside the current
  pgvector (dense) search and fuse the rankings (Reciprocal Rank Fusion).
- **P** — Reranker: re-score a larger candidate pool with a CPU cross-encoder and keep the
  best `k`.
- **Q** — Retrieval eval: compare `off` / `vector` / `hybrid` / `hybrid+rerank` on the
  existing fit-score gold set and report the deltas.

**Non-goals (deferred / out)**
- **Fine-tuning** embeddings or the LLM (Phase 4 originally, now deferred — infra).
- A new retrieval gold set / recall@k labeling (we use the **downstream delta** instead).
- IaC / e2e / caching / load test (Phase 5).
- Swapping the embedding model or vector store (keep MiniLM + pgvector).

## 3. Success criteria (acceptance)
1. With `RAG_RETRIEVAL_MODE=hybrid`, `retrieve()` fuses dense (cosine) + lexical (FTS)
   rankings via RRF and returns the top `k`; with `vector` it behaves as today. An
   un-migrated DB or an FTS error **falls back to vector-only** — retrieval never breaks.
2. With `RAG_RERANK_ENABLED=true`, retrieval pulls a larger pool (`RAG_CANDIDATE_POOL`) and a
   cross-encoder reranks it to the top `k`; any reranker load/inference error returns the
   pre-rerank top-k. User-scoping and source filters hold throughout.
3. `python -m evals.run` (or a dedicated entrypoint) can run the fit-score eval across
   retrieval modes and emit a **per-mode comparison** (context-recall / faithfulness /
   answer-relevancy / fit-vs-label Spearman); it **skips** without a DB or provider.
4. **No new dependency** (CrossEncoder ships with `sentence-transformers`); the reranker
   stays in `requirements-rag.txt`, not the lean base.
5. **Graceful degradation preserved:** no DB → RAG off (as today); no reranker model →
   pre-rerank results; no provider → evals skip. `npm run check` + agent `pytest`/`ruff` green.

## 4. Workstream O — Hybrid retrieval (`services/agent`)

- **Schema (`db/migrations/007_fts.sql`):** add a generated `tsvector` column on
  `embeddings` over `chunk_text` (`to_tsvector('english', chunk_text)`) + a **GIN** index.
  Idempotent (`add column if not exists` / `create index if not exists`).
- **Lexical query:** `websearch_to_tsquery('english', :query)` ranked by `ts_rank_cd`,
  with the same `source_type`/`source_id`/`user_id` filters as the dense path.
- **Fusion (`app/rag/fusion.py`):** **Reciprocal Rank Fusion** — `score(doc) = Σ 1/(k0+rank_i)`
  over the dense and lexical rank lists (`k0=60`), returning the top `k` by fused score. A
  pure function, unit-tested.
- **`retrieve()` mode:** `RAG_RETRIEVAL_MODE` ∈ {`vector`, `hybrid`} (default `hybrid`).
  Hybrid runs both queries (pull `candidate_pool` each), fuses, returns top `k`. On a missing
  `tsvector` column or any FTS error, log + fall back to the vector path.
- **Rejected:** a BM25 extension / external search engine — Postgres FTS is built-in and
  reuses the existing table + connection.

## 5. Workstream P — Reranker (`services/agent`)

- **`app/rag/rerank.py`:** `rerank(query, chunks, k) -> list[str]` scoring `(query, chunk)`
  pairs with a **CPU cross-encoder** (`sentence-transformers` `CrossEncoder`, default
  `cross-encoder/ms-marco-MiniLM-L-6-v2`), returning the top `k`. The model is **lazy-loaded**
  and cached (mirrors `embeddings._get_model`).
- **Wiring:** when `RAG_RERANK_ENABLED` (default true), `retrieve()` returns a pool of
  `RAG_CANDIDATE_POOL` (default 16) candidates and reranks to `k`. Any error (no model, no
  torch, inference failure) → return the pre-rerank top-`k`.
- **No new dep:** `CrossEncoder` is part of `sentence-transformers` (already in
  `requirements-rag.txt`); only a model download at runtime.
- **Rejected:** LLM-as-reranker (slower, token cost, trips the budget guard).

## 6. Workstream Q — Retrieval eval (downstream delta) (`services/agent/evals`)

- **`evals/retrieval.py`** (+ a `--retrieval-modes` path in `run.py`): for each mode in
  `off` / `vector` / `hybrid` / `hybrid+rerank`, build each fit-score row's
  `retrieved_context` via the **real retriever** under that mode (ingest the sample resume →
  retrieve per JD), run the existing fit-score scoring + Ragas, and collect
  context-recall / faithfulness / answer-relevancy / fit-vs-label Spearman.
- **Report:** a per-mode comparison table (markdown + JSON) showing the deltas; the numbers
  from a real keyed + DB run are recorded in `EVALS.md`.
- **Skip:** needs a DB (pgvector + FTS) **and** a provider; absent either, it skips cleanly
  (consistent with the existing eval). The sweep logic is unit-tested with a fake
  retriever/model (no DB/key).

## 7. Cross-cutting

- **Config (`config.py` + `.env.example`, defaults shown):** `RAG_RETRIEVAL_MODE=hybrid`,
  `RAG_RERANK_ENABLED=true`, `RAG_RERANK_MODEL=cross-encoder/ms-marco-MiniLM-L-6-v2`,
  `RAG_CANDIDATE_POOL=16`. All optional; defaults give the improved pipeline, and each can be
  turned off to fall back.
- **Testing:** O — RRF fusion (pure) + the hybrid `retrieve` path with a fake DB cursor;
  P — `rerank` with a fake CrossEncoder (ordering) + the graceful-skip path; Q — the
  mode-sweep aggregation with a fake retriever + fake scorer. All key-free / DB-free via
  mocks; preserve existing RAG/eval tests.
- **Docs:** `EVALS.md` retrieval-modes section (with real deltas), ARCHITECTURE RAG update.

## 8. Risks & mitigations
- **Reranker CPU latency** on the scale-to-zero container → small candidate pool (16), lazy
  load, toggle off; only affects score-fit, which already calls the LLM.
- **FTS on un-migrated DBs** → vector-only fallback; migration is idempotent.
- **Eval needs a DB** → the mode sweep skips without one; numbers captured from a deliberate
  local/keyed run and documented.
- **Model download cost** (cross-encoder ~80 MB) → in `requirements-rag.txt`/runtime image
  only; lazy.
- **Scope** → three focused, sequential workstreams; each degrades gracefully.

## 9. SDLC / delivery
This spec → an implementation plan (`writing-plans`) → **GitHub issues**: an **epic**
("Phase 4 — hybrid retrieval, reranker & retrieval eval") + three **sub-issues**
(O hybrid, P reranker, Q eval) under a **`Phase 4` milestone** with labels. Each sub-issue is
its own branch → PR (`Closes #…`) → green CI → **user merges**; **O→P→Q sequential** (shared
`rag/`+`evals/`). TDD where it fits; `npm run check` + agent `pytest`/`ruff` before each PR.
Exact APIs (`websearch_to_tsquery`/`ts_rank_cd`, `CrossEncoder`) confirmed via Context7 at
each workstream's first task.

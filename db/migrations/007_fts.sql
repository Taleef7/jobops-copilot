-- Lexical (full-text) side of hybrid retrieval (Phase 4 · O).
--
-- Adds a stored, auto-maintained tsvector of each chunk so we can run a
-- Postgres full-text query beside the pgvector dense query and fuse the two
-- with Reciprocal Rank Fusion (see app/rag/store.py + app/rag/fusion.py).
--
-- The two-argument to_tsvector('english', ...) pins the text-search config so
-- the GIN index stays consistent regardless of default_text_search_config, and
-- queries must use the same config (websearch_to_tsquery('english', ...)).
--
-- Idempotent: db:init replays every migration on each run, and the GENERATED
-- column requires Postgres >= 12 (the pgvector image is PG 16+). The GIN build
-- briefly locks the table for writes -- fine at portfolio scale, same as 003's
-- HNSW index.

alter table embeddings
  add column if not exists chunk_tsv tsvector
  generated always as (to_tsvector('english', chunk_text)) stored;

create index if not exists embeddings_tsv_idx on embeddings using gin (chunk_tsv);

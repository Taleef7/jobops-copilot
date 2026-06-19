"""Runtime configuration loaded from environment variables.

Field names map to upper-case env vars (case-insensitive), e.g. ``llm_provider``
reads ``LLM_PROVIDER``. Mirrors the names already used in the repo root
``.env.example`` so the Python service and the Node API share one config story.
"""

from __future__ import annotations

from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Provider selection. When unset, the first provider with credentials wins.
    llm_provider: str | None = None

    # Anthropic Claude
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-sonnet-4-6"

    # OpenAI
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"

    # Azure OpenAI
    azure_openai_endpoint: str | None = None
    azure_openai_api_key: str | None = None
    azure_openai_api_version: str = "2024-10-21"
    azure_openai_deployment: str | None = None

    # Google Gemini
    google_gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.0-flash"

    # Shared
    database_url: str | None = None
    request_timeout: int = 60
    llm_temperature: float = 0.2

    # Server-to-server auth (QA·A). The agent is reached over its public Container App
    # FQDN by the Node API (separate compute/region), so it can't rely on network
    # isolation. When set, every request must carry this secret in the
    # `Authorization: Bearer <key>` (or `X-Agent-Key`) header. Unset → auth disabled
    # (local dev / before the secret is provisioned). Health + docs stay open.
    agent_api_key: str | None = None

    # Optional web-search tool for the research agent (Phase 8)
    tavily_api_key: str | None = None

    # Langfuse tracing/observability (Phase 1 LLMOps). No-op when unset.
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_host: str = "https://cloud.langfuse.com"

    # PII handling (Phase 2 · Workstream H). Strip contact-PII before LLM calls and
    # mask it in Langfuse traces. On by default; set PII_REDACTION_ENABLED=false to opt out.
    pii_redaction_enabled: bool = True

    # LLM I/O guardrails (Phase 2 · Workstream I).
    # injection_action: "flag" (log + trace + delimit, default) or "refuse" (block the call).
    injection_action: str = "flag"
    # Output moderation on drafted outreach. Prefers the OpenAI moderation endpoint when an
    # OpenAI/dedicated key is present, else an active-provider LLM safety self-check.
    moderation_enabled: bool = True
    moderation_openai_api_key: str | None = None

    # LangGraph application-assistant (Phase 3 · Workstream K). Strong-fit threshold:
    # at/above it the assistant researches + drafts outreach; below it stops with a "pass".
    assistant_fit_threshold: int = 60

    # Agent-as-MCP-client (Phase 3 · Workstream N). JSON map of external MCP servers to load
    # research tools from, e.g. {"fetch": {"transport": "http", "url": "http://host/mcp"}}.
    # Unset → the research agent uses the built-in Tavily web_search tool.
    mcp_client_servers: str | None = None

    # RAG retrieval (Phase 4 · O). mode: "vector" (dense only) or "hybrid" (dense + FTS via RRF).
    # Literal so a typo (e.g. RAG_RETRIEVAL_MODE=hibrid) fails loud at startup rather than
    # silently falling through to vector-only.
    rag_retrieval_mode: Literal["vector", "hybrid"] = "hybrid"
    rag_candidate_pool: int = 16  # candidates pulled per side before fusion / rerank

    # CPU cross-encoder reranker (Phase 4 · P). Opt-in: off by default to avoid a cold-start
    # model download + CPU inference on the first score-fit request. When on, retrieve() reranks
    # the candidate pool down to k. CrossEncoder ships with sentence-transformers (no new dep).
    rag_rerank_enabled: bool = False
    rag_rerank_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"


settings = Settings()

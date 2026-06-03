"""Runtime configuration loaded from environment variables.

Field names map to upper-case env vars (case-insensitive), e.g. ``llm_provider``
reads ``LLM_PROVIDER``. Mirrors the names already used in the repo root
``.env.example`` so the Python service and the Node API share one config story.
"""

from __future__ import annotations

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

    # Optional web-search tool for the research agent (Phase 8)
    tavily_api_key: str | None = None


settings = Settings()

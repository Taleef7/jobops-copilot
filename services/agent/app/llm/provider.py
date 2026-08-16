"""Provider-agnostic LLM router.

Selects between Anthropic Claude, Azure OpenAI, OpenAI, and Google Gemini based
on ``LLM_PROVIDER`` (explicit) or whichever credentials are present (implicit).
Built on LangChain's ``init_chat_model`` so the rest of the service is provider
independent.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from functools import lru_cache

from langchain.chat_models import init_chat_model

from app.config import settings

logger = logging.getLogger("jobops.agent.provider")


class LLMNotConfigured(RuntimeError):
    """Raised when no provider credentials are available."""


def resolve_provider() -> str | None:
    """Return the active provider id, or None when nothing is configured."""
    if settings.llm_provider:
        return settings.llm_provider.strip().lower()
    if settings.anthropic_api_key:
        return "anthropic"
    if settings.azure_openai_api_key and settings.azure_openai_endpoint:
        return "azure_openai"
    if settings.openai_api_key:
        return "openai"
    if settings.google_gemini_api_key:
        return "google_genai"
    return None


def llm_available() -> bool:
    return resolve_provider() is not None


@lru_cache(maxsize=1)
def get_model():
    """Return ``(chat_model, model_label)`` for the active provider.

    ``model_label`` is recorded as ``model_used`` on responses for auditability.
    """
    provider = resolve_provider()
    if provider is None:
        raise LLMNotConfigured(
            "No LLM provider configured. Set LLM_PROVIDER and the matching API key "
            "(ANTHROPIC_API_KEY, AZURE_OPENAI_*, OPENAI_API_KEY, or GOOGLE_GEMINI_API_KEY)."
        )

    common = {"temperature": settings.llm_temperature, "timeout": settings.request_timeout}

    if provider == "anthropic":
        model = settings.anthropic_model
        chat = init_chat_model(
            f"anthropic:{model}", api_key=settings.anthropic_api_key, **common
        )
    elif provider == "openai":
        model = settings.openai_model
        chat = init_chat_model(f"openai:{model}", api_key=settings.openai_api_key, **common)
    elif provider == "azure_openai":
        model = settings.azure_openai_deployment or "gpt-4o-mini"
        chat = init_chat_model(
            model,
            model_provider="azure_openai",
            azure_endpoint=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_api_key,
            api_version=settings.azure_openai_api_version,
            **common,
        )
    elif provider == "google_genai":
        model = settings.gemini_model
        chat = init_chat_model(
            f"google_genai:{model}", api_key=settings.google_gemini_api_key, **common
        )
    else:
        raise LLMNotConfigured(f"Unsupported LLM_PROVIDER: {provider!r}")

    return chat, f"{provider}:{model}"


# --- Per-agent model resolution (Jobright-parity Epic 1, #252) ------------------------
#
# Each specialist agent resolves its model from the active `agent_configs` row at call
# time, so a `PUT /api/agents/:agentId/config` swap takes effect within one TTL instead
# of a deploy. Everything above stays the env-based path and is the fallback here.

KNOWN_AGENT_IDS: frozenset[str] = frozenset(
    {"feed-curator", "resume-tailor", "apply-copilot", "connection-scout"}
)

# How long a fetched active-config row is trusted before re-reading the database. Small
# enough that a repoint lands quickly; large enough that a feed-scoring burst does not
# hammer Postgres.
ACTIVE_CONFIG_TTL_SECONDS = 60.0

# Row params are attacker-free (operator-only endpoint) but still allowlisted, so a typo
# in `params` cannot smuggle arbitrary kwargs into the client constructor.
FORWARDED_PARAMS = ("temperature", "max_tokens", "top_p", "reasoning_effort")


@dataclass(frozen=True)
class AgentConfig:
    """One active row of `agent_configs`."""

    agent_id: str
    version: int
    model: str  # "provider:model-id"
    params: dict
    prompt_overrides: dict


_active_lock = threading.Lock()
_model_lock = threading.Lock()
# agent_id -> (fetched_at_monotonic, config or None)
_active_cache: dict[str, tuple[float, AgentConfig | None]] = {}
# (agent_id, version) -> (chat_model, "provider:model-id")
_model_cache: dict[tuple[str, int], tuple[object, str]] = {}


def _connect(dsn: str):
    """Open a psycopg connection.

    Imported lazily and isolated in its own function: the light CI job installs only
    `requirements.txt` (no psycopg), and tests patch this seam instead of the driver.
    """
    import psycopg

    return psycopg.connect(dsn, connect_timeout=5)


def _fetch_active_config(agent_id: str) -> AgentConfig | None:
    """Read the active `agent_configs` row, or None when it cannot be read.

    Returns None — never raises — when `DATABASE_URL` is unset, psycopg is absent, the
    table does not exist yet, the database is unreachable, or no row is active. A config
    database outage degrades an agent to its env model; it must not take the agent down.
    """
    if not settings.database_url:
        return None
    try:
        with _connect(settings.database_url) as conn:
            row = conn.execute(
                "select version, model, params, prompt_overrides"
                " from agent_configs where agent_id = %s and active",
                (agent_id,),
            ).fetchone()
    except Exception:  # noqa: BLE001 - see docstring: this path must never raise
        logger.warning(
            "agent_configs lookup failed for %s; using the env model", agent_id, exc_info=True
        )
        return None
    if row is None:
        return None

    version, model, params, prompt_overrides = row
    if isinstance(params, str):
        params = json.loads(params)
    if isinstance(prompt_overrides, str):
        prompt_overrides = json.loads(prompt_overrides)
    return AgentConfig(
        agent_id, int(version), str(model), dict(params or {}), dict(prompt_overrides or {})
    )


def _active_config(agent_id: str) -> AgentConfig | None:
    """TTL-cached `_fetch_active_config`, so a scoring burst reads the row once."""
    now = time.monotonic()
    with _active_lock:
        cached = _active_cache.get(agent_id)
        if cached is not None and now - cached[0] < ACTIVE_CONFIG_TTL_SECONDS:
            return cached[1]

    config = _fetch_active_config(agent_id)
    with _active_lock:
        _active_cache[agent_id] = (now, config)
    return config


def _provider_credentials(provider: str) -> dict | None:
    """`init_chat_model` credential kwargs, or None for an unsupported provider.

    Keys live in pydantic settings rather than `os.environ`, so they must be passed
    explicitly.
    """
    if provider == "anthropic":
        return {"api_key": settings.anthropic_api_key}
    if provider == "openai":
        return {"api_key": settings.openai_api_key}
    if provider == "azure_openai":
        return {
            "azure_endpoint": settings.azure_openai_endpoint,
            "api_key": settings.azure_openai_api_key,
            "api_version": settings.azure_openai_api_version,
        }
    if provider == "google_genai":
        return {"api_key": settings.google_gemini_api_key}
    return None


def _build_model(config: AgentConfig):
    """Construct the chat client for a config row, or None if it is not usable here."""
    provider, _, model_id = config.model.partition(":")
    credentials = _provider_credentials(provider)
    if credentials is None:
        logger.warning(
            "agent %s is configured for unsupported provider %r; using the env model",
            config.agent_id,
            provider,
        )
        return None
    if not any(credentials.values()):
        logger.warning(
            "agent %s is configured for %s but no credentials are set; using the env model",
            config.agent_id,
            provider,
        )
        return None

    kwargs = {"timeout": settings.request_timeout, **credentials}
    for name in FORWARDED_PARAMS:
        if name in config.params:
            kwargs[name] = config.params[name]
    kwargs.setdefault("temperature", settings.llm_temperature)

    if provider == "azure_openai":
        return init_chat_model(model_id, model_provider="azure_openai", **kwargs)
    return init_chat_model(f"{provider}:{model_id}", **kwargs)


def get_model_for_agent(agent_id: str):
    """Return ``(chat_model, model_label, config)`` for one specialist agent.

    Resolution order:
      1. the active ``agent_configs`` row — hot-swappable at runtime, no deploy;
      2. the env-based :func:`get_model` when there is no database, no row, or the row
         names a provider this deployment cannot use, in which case ``config`` is None.

    ``model_label`` always names the model actually used, so ``model_used`` on a response
    never claims a model the call did not go through.
    """
    if agent_id not in KNOWN_AGENT_IDS:
        raise ValueError(f"Unknown agent_id: {agent_id!r}")

    config = _active_config(agent_id)
    if config is None:
        chat, label = get_model()
        return chat, label, None

    key = (agent_id, config.version)
    with _model_lock:
        cached = _model_cache.get(key)
    if cached is not None:
        return cached[0], cached[1], config

    chat = _build_model(config)
    if chat is None:
        fallback, label = get_model()
        return fallback, label, None

    with _model_lock:
        _model_cache[key] = (chat, config.model)
        # Drop other versions of this agent so a long-lived process does not hoard clients.
        for stale in [k for k in _model_cache if k[0] == agent_id and k != key]:
            _model_cache.pop(stale, None)
    return chat, config.model, config

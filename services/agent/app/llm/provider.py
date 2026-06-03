"""Provider-agnostic LLM router.

Selects between Anthropic Claude, Azure OpenAI, OpenAI, and Google Gemini based
on ``LLM_PROVIDER`` (explicit) or whichever credentials are present (implicit).
Built on LangChain's ``init_chat_model`` so the rest of the service is provider
independent.
"""

from __future__ import annotations

from functools import lru_cache

from langchain.chat_models import init_chat_model

from app.config import settings


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

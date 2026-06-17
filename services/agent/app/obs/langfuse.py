"""Langfuse tracing for the agent's LLM and agent calls.

No-op safe: when Langfuse keys are not configured (or the SDK is unavailable),
``traced_config`` returns an empty config so chains run untraced and nothing
breaks. This keeps CI and key-less local runs working unchanged.
"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager

from app.config import settings
from app.safety.pii import redact_pii_in_obj

logger = logging.getLogger("jobops.agent.obs")


def _enabled() -> bool:
    return bool(settings.langfuse_public_key and settings.langfuse_secret_key)


def _mask(*, data, **_kwargs):
    """Langfuse ``mask`` callback (Phase 2 · Workstream H): scrub contact-PII from trace
    inputs/outputs before they leave the process. Gated by the same redaction toggle and
    never raises into the SDK."""
    if not settings.pii_redaction_enabled:
        return data
    try:
        return redact_pii_in_obj(data)
    except Exception:  # noqa: BLE001 - masking must never break tracing
        return data


_client_ready = False


def _ensure_client():
    """Initialize the singleton Langfuse client with PII masking, once, and return it.

    Returns ``None`` when tracing is disabled or the SDK is unavailable. Constructing
    ``Langfuse(mask=...)`` registers the global client that ``get_client()`` and the
    LangChain ``CallbackHandler`` reuse, so the mask applies to every trace; keys/host
    are read from the env bridged by ``_bridge_env`` to avoid SDK-version kwarg drift."""
    global _client_ready
    if not _enabled():
        return None
    try:
        _bridge_env()
        from langfuse import Langfuse, get_client

        if not _client_ready:
            Langfuse(mask=_mask)
            _client_ready = True
        return get_client()
    except Exception:  # noqa: BLE001 - tracing must never break the request path
        logger.warning("Langfuse client unavailable; tracing disabled", exc_info=True)
        return None


def _bridge_env() -> None:
    """The agent reads .env via pydantic-settings, which does not populate
    os.environ; bridge the values so the env-based Langfuse SDK picks them up.
    Both LANGFUSE_HOST and LANGFUSE_BASE_URL are set so self-hosted/region hosts
    work regardless of which the installed SDK version reads."""
    os.environ["LANGFUSE_PUBLIC_KEY"] = settings.langfuse_public_key or ""
    os.environ["LANGFUSE_SECRET_KEY"] = settings.langfuse_secret_key or ""
    os.environ["LANGFUSE_HOST"] = settings.langfuse_host
    os.environ["LANGFUSE_BASE_URL"] = settings.langfuse_host


def _handler():
    """Return a Langfuse LangChain callback handler, or ``None`` when disabled.

    Routes through ``_ensure_client`` first so the PII-masking client is the singleton
    the handler attaches to."""
    if _ensure_client() is None:
        return None
    try:
        from langfuse.langchain import CallbackHandler

        return CallbackHandler()
    except Exception:  # noqa: BLE001 - tracing must never break the request path
        logger.warning("Langfuse handler unavailable; tracing disabled", exc_info=True)
        return None


@contextmanager
def traced_span(name: str, **input_attrs):
    """Best-effort Langfuse span around custom (non-LangChain) work — e.g. RAG
    retrieval. Yields the span object (or ``None`` when tracing is disabled or
    unavailable) and never raises into the caller."""
    client = _ensure_client()
    if client is None:
        yield None
        return

    # Set up the span. Only Langfuse *setup* failures degrade to a no-op here;
    # exceptions from the wrapped body must propagate (catching them at `yield`
    # would raise "generator didn't stop" and mask the real error).
    try:
        span_cm = client.start_as_current_observation(
            as_type="span", name=name, input=input_attrs or None
        )
    except Exception:  # noqa: BLE001 - tracing setup must never break the caller
        logger.warning("Langfuse span setup failed; continuing without it", exc_info=True)
        yield None
        return

    with span_cm as span:
        yield span


def traced_config(name: str, session_id: str | None = None, user_id: str | None = None) -> dict:
    """Build a LangChain ``config`` that traces the run in Langfuse.

    ``name`` becomes the trace name; ``session_id``/``user_id`` (when given) group
    traces in the Langfuse UI. Returns an empty dict when tracing is disabled, so
    callers can always write ``chain.invoke(messages, config=traced_config(...) or None)``.
    """
    handler = _handler()
    if handler is None:
        return {}

    config: dict = {"callbacks": [handler], "run_name": name}
    metadata: dict = {}
    if session_id:
        metadata["langfuse_session_id"] = session_id
    if user_id:
        metadata["langfuse_user_id"] = user_id
    if metadata:
        config["metadata"] = metadata
    return config

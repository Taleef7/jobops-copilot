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

logger = logging.getLogger("jobops.agent.obs")


def _enabled() -> bool:
    return bool(settings.langfuse_public_key and settings.langfuse_secret_key)


def _bridge_env() -> None:
    """The agent reads .env via pydantic-settings, which does not populate
    os.environ; bridge the values so the env-based Langfuse SDK picks them up."""
    os.environ["LANGFUSE_PUBLIC_KEY"] = settings.langfuse_public_key or ""
    os.environ["LANGFUSE_SECRET_KEY"] = settings.langfuse_secret_key or ""
    os.environ["LANGFUSE_HOST"] = settings.langfuse_host


def _handler():
    """Return a Langfuse LangChain callback handler, or ``None`` when disabled."""
    if not _enabled():
        return None
    try:
        _bridge_env()
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
    if not _enabled():
        yield None
        return
    try:
        _bridge_env()
        from langfuse import get_client

        with get_client().start_as_current_observation(
            as_type="span", name=name, input=input_attrs or None
        ) as span:
            yield span
    except Exception:  # noqa: BLE001 - tracing must never break the request path
        logger.warning("Langfuse span failed; continuing without it", exc_info=True)
        yield None


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

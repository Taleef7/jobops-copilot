"""Langfuse tracing for the agent's LLM and agent calls.

No-op safe: when Langfuse keys are not configured (or the SDK is unavailable),
``traced_config`` returns an empty config so chains run untraced and nothing
breaks. This keeps CI and key-less local runs working unchanged.
"""

from __future__ import annotations

import logging
import os

from app.config import settings

logger = logging.getLogger("jobops.agent.obs")


def _enabled() -> bool:
    return bool(settings.langfuse_public_key and settings.langfuse_secret_key)


def _handler():
    """Return a Langfuse LangChain callback handler, or ``None`` when disabled."""
    if not _enabled():
        return None
    try:
        # The agent reads .env via pydantic-settings, which does not populate
        # os.environ; bridge the values across so the Langfuse SDK (env-based)
        # picks them up.
        os.environ["LANGFUSE_PUBLIC_KEY"] = settings.langfuse_public_key or ""
        os.environ["LANGFUSE_SECRET_KEY"] = settings.langfuse_secret_key or ""
        os.environ["LANGFUSE_HOST"] = settings.langfuse_host

        from langfuse.langchain import CallbackHandler

        return CallbackHandler()
    except Exception:  # noqa: BLE001 - tracing must never break the request path
        logger.warning("Langfuse handler unavailable; tracing disabled", exc_info=True)
        return None


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

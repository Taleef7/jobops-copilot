"""Server-to-server authentication for the agent service (QA·A).

The agent runs as a public Container App and is called over its internet-facing
FQDN by the Node API (different compute, different region), so network isolation
isn't available. Every request must therefore present the shared secret in the
``Authorization: Bearer <AGENT_API_KEY>`` (or ``X-Agent-Key``) header.

Exemption: the liveness probe (``/health``, which says only ``{"status": "ok"}``) stays
open for the container health probe. Everything else, including ``/openapi.json`` and the
model details, needs the secret (#348). When ``AGENT_API_KEY`` is unset, auth is disabled entirely
(local dev / before the secret is provisioned in prod).
"""

from __future__ import annotations

import hmac
import os
from collections.abc import Mapping

from app.config import settings

# Reachable without the shared secret: only the liveness probe, whose body is just
# {"status": "ok"}. The route map (/openapi.json, /docs, /redoc), the model details
# (/health/details) and the paid canary (/health/llm) all need the key (#348).
PUBLIC_PATHS: frozenset[str] = frozenset({"/health"})


def is_production_runtime() -> bool:
    """True on an Azure cloud runtime.

    Container Apps sets ``CONTAINER_APP_NAME``; App Service sets ``WEBSITE_SITE_NAME``.
    Either signals an internet-facing deployment where auth must not be disabled.
    """
    return bool(os.environ.get("CONTAINER_APP_NAME") or os.environ.get("WEBSITE_SITE_NAME"))


def assert_auth_configured() -> None:
    """Fail closed: refuse to start on a cloud runtime without a shared secret.

    Unset ``AGENT_API_KEY`` disables auth entirely, which is fine for local dev but would
    leave the public Container App open. Called at startup so a misconfigured deploy fails
    loud instead of silently serving unauthenticated.
    """
    if is_production_runtime() and not settings.agent_api_key:
        raise RuntimeError(
            "FATAL: agent running on a cloud runtime (CONTAINER_APP_NAME / WEBSITE_SITE_NAME set) "
            "without AGENT_API_KEY. Refusing to start — auth would be disabled on an "
            "internet-facing service. Provision AGENT_API_KEY."
        )


def extract_key(headers: Mapping[str, str]) -> str | None:
    """Pull the shared secret from the Authorization (Bearer) or X-Agent-Key header."""
    authorization = headers.get("authorization")
    if authorization:
        # Tolerant of multiple spaces/tabs between scheme and token (RFC 7235).
        parts = authorization.split(None, 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1].strip()
    return headers.get("x-agent-key")


def is_authorized(path: str, headers: Mapping[str, str]) -> bool:
    """True when the request may proceed.

    Allows everything when no key is configured (auth disabled), always allows the
    public probe/docs paths, otherwise requires a constant-time match of the secret.
    """
    expected = settings.agent_api_key
    if not expected:
        return True
    if path in PUBLIC_PATHS:
        return True
    provided = extract_key(headers) or ""
    # constant-time compare; compare_digest also returns False on length mismatch.
    return hmac.compare_digest(provided, expected)

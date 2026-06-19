"""Server-to-server authentication for the agent service (QA·A).

The agent runs as a public Container App and is called over its internet-facing
FQDN by the Node API (different compute, different region), so network isolation
isn't available. Every request must therefore present the shared secret in the
``Authorization: Bearer <AGENT_API_KEY>`` (or ``X-Agent-Key``) header.

Exemptions: the liveness probe and the OpenAPI/docs surface stay open so the
container health probe and ``scripts/azure/deploy-agent.sh`` verify keep working
without the secret. When ``AGENT_API_KEY`` is unset, auth is disabled entirely
(local dev / before the secret is provisioned in prod).
"""

from __future__ import annotations

import hmac
from collections.abc import Mapping

from app.config import settings

# Reachable without the shared secret: container liveness probe + the API schema
# /docs (used by health probes and the deploy-agent.sh `/openapi.json` verify).
PUBLIC_PATHS: frozenset[str] = frozenset(
    {"/health", "/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}
)


def extract_key(headers: Mapping[str, str]) -> str | None:
    """Pull the shared secret from the Authorization (Bearer) or X-Agent-Key header."""
    authorization = headers.get("authorization")
    if authorization and authorization[:7].lower() == "bearer ":
        return authorization[7:].strip()
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

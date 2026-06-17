"""Compatibility shim for Ragas + langchain-community 0.4.x.

Ragas (0.3–0.4) imports ``langchain_community.chat_models.vertexai.ChatVertexAI``
at module load, but langchain-community 0.4 (which the agent's langchain 1.x stack
pulls in) removed that submodule. Ragas only uses ``ChatVertexAI`` in isinstance
checks for VertexAI-specific handling; our judge is OpenAI/Anthropic, so a
placeholder no instance can match is safe. Register it before importing Ragas.
"""

from __future__ import annotations

import sys
import types


def ensure_ragas_importable() -> None:
    """Inject a stub ``langchain_community.chat_models.vertexai`` if it's missing."""
    name = "langchain_community.chat_models.vertexai"
    if name in sys.modules:
        return
    try:  # real module present (older langchain-community) — nothing to do
        __import__(name)
        return
    except Exception:  # noqa: BLE001 - fall through to the placeholder
        pass

    stub = types.ModuleType(name)

    class ChatVertexAI:  # noqa: D401 - placeholder; never instantiated
        """Placeholder so Ragas' isinstance checks resolve (no VertexAI in use)."""

    stub.ChatVertexAI = ChatVertexAI
    sys.modules[name] = stub

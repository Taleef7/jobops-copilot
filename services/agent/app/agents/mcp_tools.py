"""Agent-as-MCP-client tool loading (Phase 3 · Workstream N).

Loads tools from external MCP servers (via langchain-mcp-adapters) for the research agent,
with graceful fallback to the built-in Tavily ``web_search`` tool. Never raises into the
request path: any misconfiguration / unreachable server / async-context limitation degrades
to Tavily, so research behavior is unchanged when MCP isn't available.
"""

from __future__ import annotations

import asyncio
import json
import logging

from app.agents.tools import web_search
from app.config import settings

logger = logging.getLogger("jobops.agent.mcp")

_cache: list | None = None  # external MCP tools, cached only after a successful load


def _load_external_mcp_tools() -> list | None:
    """Load tools from the configured MCP servers, or ``None`` when unavailable.

    Returns ``None`` (→ caller falls back to Tavily) when no servers are configured, when
    called from within a running event loop (``get_tools`` is async and we can't
    ``asyncio.run`` there), or on any error.
    """
    if not settings.mcp_client_servers:
        return None
    try:
        asyncio.get_running_loop()
        return None  # inside an async loop (e.g. the streaming graph) — skip this call
    except RuntimeError:
        pass  # no running loop → safe to drive the async client
    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient

        connections = json.loads(settings.mcp_client_servers)
        tools = asyncio.run(MultiServerMCPClient(connections).get_tools())
        return tools or None
    except Exception:  # noqa: BLE001 - MCP is best-effort; fall back to Tavily with a log
        logger.warning("External MCP tools unavailable; using Tavily web_search", exc_info=True)
        return None


def load_research_tools() -> list:
    """Tools for the research agent: external MCP tools when available, else Tavily."""
    global _cache
    if _cache is not None:
        return _cache
    tools = _load_external_mcp_tools()
    if tools:
        _cache = tools  # cache only a successful MCP load
        return tools
    return [web_search]  # don't cache the fallback — retry from a sync context next time


def reset_mcp_tools_cache() -> None:
    """Clear the cached MCP tools (tests)."""
    global _cache
    _cache = None

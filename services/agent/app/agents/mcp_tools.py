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
from typing import Any

from langchain_core.tools import BaseTool

from app.agents.tools import web_search
from app.config import settings
from app.safety.injection import guard_tool_content

logger = logging.getLogger("jobops.agent.mcp")


class _GuardedTool(BaseTool):
    """Wraps another tool, delimiting its string output as untrusted data (QA·G).

    External MCP tools return third-party content the research agent ingests, so it
    carries the same indirect-injection risk as web search. We delegate to the wrapped
    tool and run its string result through ``guard_tool_content`` (scan + BEGIN/END
    delimiters). Non-string results pass through untouched.
    """

    wrapped: BaseTool

    def _guard(self, output: Any) -> Any:
        if isinstance(output, str):
            return guard_tool_content(output, f"{self.wrapped.name.upper()} RESULTS")
        return output

    def _run(self, *args: Any, **kwargs: Any) -> Any:
        kwargs.pop("run_manager", None)
        return self._guard(self.wrapped.invoke(kwargs or (args[0] if args else {})))

    async def _arun(self, *args: Any, **kwargs: Any) -> Any:
        kwargs.pop("run_manager", None)
        return self._guard(await self.wrapped.ainvoke(kwargs or (args[0] if args else {})))


def guard_tools(tools: list) -> list:
    """Wrap each tool so its string output is delimited as untrusted data."""
    guarded = []
    for tool in tools:
        if isinstance(tool, BaseTool):
            guarded.append(
                _GuardedTool(
                    name=tool.name,
                    description=tool.description,
                    args_schema=tool.args_schema,
                    wrapped=tool,
                )
            )
        else:  # not a BaseTool we can introspect — leave as-is rather than break loading
            guarded.append(tool)
    return guarded

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
    """Tools for the research agent: external MCP tools when available, else Tavily.

    QA·G: both paths delimit/scan their (untrusted, third-party) tool output — the
    built-in Tavily ``web_search`` does so itself; external MCP tools are wrapped in
    ``_GuardedTool`` so their content is treated as data, not instructions.
    """
    global _cache
    if _cache is not None:
        return _cache
    tools = _load_external_mcp_tools()
    if tools:
        _cache = guard_tools(tools)  # cache only a successful MCP load
        return _cache
    return [web_search]  # don't cache the fallback — retry from a sync context next time


def reset_mcp_tools_cache() -> None:
    """Clear the cached MCP tools (tests)."""
    global _cache
    _cache = None

"""Tools available to the agents.

The web_search tool uses Tavily when ``TAVILY_API_KEY`` is set, and degrades
gracefully (returns a clear note) when it is not — so the research agent always
runs, with or without live search.
"""

from __future__ import annotations

import logging

import httpx
from langchain.tools import tool

from app.config import settings

logger = logging.getLogger("jobops.agent.tools")


@tool
def web_search(query: str) -> str:
    """Search the public web for recent, factual information about a company,
    product, person, or job role. Use this to gather details you do not already
    know before answering."""
    if not settings.tavily_api_key:
        return (
            "Web search is unavailable (no TAVILY_API_KEY). Answer from the provided "
            "context and general knowledge, and clearly flag anything that should be verified."
        )
    try:
        response = httpx.post(
            "https://api.tavily.com/search",
            headers={"Authorization": f"Bearer {settings.tavily_api_key}"},
            json={"query": query, "max_results": 5, "search_depth": "basic"},
            timeout=settings.request_timeout,
        )
        response.raise_for_status()
        results = response.json().get("results", [])
        if not results:
            return "No web results found."
        return "\n\n".join(
            f"- {item.get('title')}: {item.get('content', '')[:300]} ({item.get('url')})"
            for item in results
        )
    except Exception as exc:  # noqa: BLE001 - tool failures must not crash the agent
        logger.warning("web_search failed: %s", exc)
        return f"Web search failed ({exc}). Proceed from available context and flag what to verify."

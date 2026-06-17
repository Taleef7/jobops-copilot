"""JobOps Copilot MCP server (Phase 3 · Workstream L).

A FastMCP server (streamable-HTTP) that exposes JobOps as tools, implemented as a thin
bridge over the existing REST API (see api_client). Run it and connect an MCP client
(e.g. MCP Inspector or Claude) — see README.md.

Auth model: the server holds the shared API key server-side (MCP_SERVER_API_KEY) and acts
on behalf of the `user_id` passed to each tool. Deploy it behind network access control;
the shared key is never exposed to MCP clients.
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

import api_client

mcp = FastMCP("jobops", stateless_http=True, json_response=True)


@mcp.tool()
def search_jobs(user_id: str, query: str = "") -> list[dict]:
    """List the user's tracked jobs, optionally filtered by a title/company substring."""
    return api_client.search_jobs(user_id, query)


@mcp.tool()
def get_job(user_id: str, job_id: str) -> dict | None:
    """Get one job (with its analysis and outreach drafts) by id."""
    return api_client.get_job(user_id, job_id)


@mcp.tool()
def list_saved_searches(user_id: str) -> list[dict]:
    """List the user's saved job searches."""
    return api_client.list_saved_searches(user_id)


@mcp.tool()
def score_fit(user_id: str, job_id: str) -> dict:
    """Score the user's resume against a stored job and return the structured assessment."""
    return api_client.score_fit(user_id, job_id)


@mcp.tool()
def draft_outreach(user_id: str, job_id: str, message_type: str = "recruiter_email") -> dict:
    """Draft outreach for a stored job (human-review only — never sends)."""
    return api_client.draft_outreach(user_id, job_id, message_type)


def main() -> None:
    mcp.run(transport="streamable-http")


if __name__ == "__main__":
    main()

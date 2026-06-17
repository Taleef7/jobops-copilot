"""Thin REST bridge to the JobOps API (Phase 3 · Workstream L).

Each MCP tool delegates here rather than touching the database, so the MCP server reuses
every store, guard, and rate-limit the API already enforces. Calls send the shared API key
(`MCP_SERVER_API_KEY`, which must equal the API's `API_SHARED_SECRET`) plus the acting
`X-User-Id`, so the API's service-auth path (Task L0) resolves the user.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

# Injectable for tests (e.g. httpx.MockTransport); None → real network transport.
_transport: httpx.BaseTransport | None = None


def _base_url() -> str:
    return os.environ.get("MCP_SERVER_API_BASE_URL", "http://127.0.0.1:4000").rstrip("/")


def _headers(user_id: str) -> dict[str, str]:
    return {
        "X-API-Key": os.environ.get("MCP_SERVER_API_KEY", ""),
        "X-User-Id": user_id,
        "Content-Type": "application/json",
    }


def _request(method: str, path: str, user_id: str, json: dict | None = None) -> Any:
    with httpx.Client(base_url=_base_url(), timeout=30, transport=_transport) as client:
        response = client.request(method, path, headers=_headers(user_id), json=json)
        response.raise_for_status()
        return response.json()


def search_jobs(user_id: str, query: str = "") -> list[dict]:
    """The user's tracked jobs, optionally filtered by a title/company substring."""
    jobs = _request("GET", "/api/jobs", user_id).get("jobs", [])
    if query:
        needle = query.lower()
        jobs = [j for j in jobs if needle in f"{j.get('title', '')} {j.get('company', '')}".lower()]
    return jobs


def get_job(user_id: str, job_id: str) -> dict | None:
    """A single job with its analysis and outreach."""
    return _request("GET", f"/api/jobs/{job_id}", user_id).get("job")


def list_saved_searches(user_id: str) -> list[dict]:
    return _request("GET", "/api/saved-searches", user_id).get("savedSearches", [])


def score_fit(user_id: str, job_id: str) -> dict:
    """Score the user's resume against a stored job (uses the saved profile)."""
    return _request("POST", "/api/ai/score-fit", user_id, json={"job_id": job_id})


def draft_outreach(user_id: str, job_id: str, message_type: str = "recruiter_email") -> dict:
    """Draft (human-review) outreach for a stored job. Never sends."""
    body = {"job_id": job_id, "message_type": message_type}
    return _request("POST", "/api/ai/draft-outreach", user_id, json=body)

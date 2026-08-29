"""Assistant subagent tools -> specialist compiled graphs (Epic 1 / #256).

Each tool closes over the specialist registry and the calling user_id (tenancy).
Tools invoke the corresponding graph asynchronously with an isolated thread_id
and return structured JSON so the chat model can reason over the result.
"""
from __future__ import annotations

import json
import logging
import uuid

from langchain_core.tools import BaseTool, tool

from app.config import settings
from app.obs.agent_tags import tags_for

logger = logging.getLogger("jobops.agent.specialist_tools")


def make_chat_tool_thread_id(user_id: str, agent_id: str) -> str:
    return f"{user_id}:{agent_id}:chat-{uuid.uuid4()}"


async def _run_specialist(registry: dict, agent_id: str, user_id: str, payload: dict) -> str:
    from app.main import _traced_graph_config

    graph = registry.get(agent_id)
    if graph is None:
        return json.dumps({"error": f"Specialist agent not available: {agent_id}"})

    thread_id = make_chat_tool_thread_id(user_id, agent_id)
    config = _traced_graph_config(
        f"agent-{agent_id}",
        thread_id,
        user_id,
        tags=tags_for(agent_id),
        recursion_limit=settings.agent_recursion_limit_pipeline,
    )
    try:
        state = await graph.ainvoke(
            {"user_id": user_id, "input": payload, "status": "running"},
            config,
        )
    except Exception as exc:  # noqa: BLE001 - tool failures must return JSON error
        logger.exception("specialist %s invocation failed", agent_id)
        return json.dumps({"error": str(exc)})

    if isinstance(state, dict) and "__interrupt__" in state:
        return json.dumps({"status": "awaiting_approval", "thread_id": thread_id})
    if isinstance(state, dict):
        return json.dumps({"status": state.get("status"), "output": state.get("output")})
    return json.dumps({"status": "done", "output": state})


def build_specialist_tools(
    registry: dict | None = None,
    user_id: str = "anonymous",
    default_job_id: str | None = None,
) -> list[BaseTool]:
    """The four specialist tools closed over the graph registry and user_id."""
    if isinstance(registry, str) and not isinstance(user_id, dict):
        user_id, registry = registry, user_id
    if registry is None:
        from app.main import _get_agent_registry

        registry = _get_agent_registry() or {}

    @tool
    async def run_feed_curation(query: str = "") -> str:
        """Score and rank the user's job feed. Use when the user asks to refresh,
        score, or curate their job matches."""
        return await _run_specialist(registry, "feed-curator", user_id, {"query": query})

    @tool
    async def tailor_resume(job_id: str = "") -> str:
        """Start tailoring the user's resume for one job (job_id from the pipeline).
        The tailored resume always requires the user's explicit approval before render."""
        effective_job_id = (job_id or "").strip() or (default_job_id or "").strip()
        return await _run_specialist(
            registry, "resume-tailor", user_id, {"job_id": effective_job_id}
        )

    @tool
    async def build_application_pack(job_id: str = "") -> str:
        """Assemble the application pack (resume, cover letter, ATS answers) for one job."""
        effective_job_id = (job_id or "").strip() or (default_job_id or "").strip()
        return await _run_specialist(
            registry, "apply-copilot", user_id, {"job_id": effective_job_id}
        )

    @tool
    async def scout_connections(job_id: str = "") -> str:
        """Find publicly-verifiable people (recruiters, hiring managers, teammates)
        relevant to one job. Public web only; nothing is contacted."""
        effective_job_id = (job_id or "").strip() or (default_job_id or "").strip()
        return await _run_specialist(
            registry, "connection-scout", user_id, {"job_id": effective_job_id}
        )

    return [run_feed_curation, tailor_resume, build_application_pack, scout_connections]


create_specialist_tools = build_specialist_tools

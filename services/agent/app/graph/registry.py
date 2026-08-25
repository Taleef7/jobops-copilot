"""Registry of the four Jobright-parity specialist graph entrypoints.

The graphs intentionally remain no-cost echo stubs until the specialist behavior is
implemented in later tickets. They are still real, separately compiled LangGraph
graphs so the streaming and checkpoint contracts are exercised now.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from langgraph.graph import END, START, StateGraph

from app.graph.agent_state import AgentRunState
from app.llm.provider import get_model_for_agent

AGENT_IDS = ("feed-curator", "resume-tailor", "apply-copilot", "connection-scout")


def make_thread_id(user_id: str, agent_id: str, job_id: str | None = None) -> str:
    """Return a tenant- and agent-scoped checkpoint id."""
    return f"{user_id}:{agent_id}" + (f":{job_id}" if job_id else "")


def _echo_node(agent_id: str) -> Callable[[AgentRunState], dict[str, Any]]:
    def echo(state: AgentRunState) -> dict[str, Any]:
        # Resolving a configured model records the eventual model label without ever
        # invoking it. Keyless CI/local runs intentionally use an explicit fallback label.
        try:
            _model, model_label, _config = get_model_for_agent(agent_id)
        except Exception:  # noqa: BLE001 - provider setup is optional for echo stubs
            model_label = "unconfigured"
        return {
            "output": {"agent_id": agent_id, "echo": state.get("input", {}), "model": model_label},
            "status": "done",
        }

    return echo


def _build_graph(agent_id: str, checkpointer=None, store=None):
    builder = StateGraph(AgentRunState)
    builder.add_node("echo", _echo_node(agent_id))
    builder.add_edge(START, "echo")
    builder.add_edge("echo", END)
    return builder.compile(checkpointer=checkpointer, store=store, name=agent_id)


def build_feed_curator_graph(checkpointer=None, store=None):
    return _build_graph("feed-curator", checkpointer, store)


def build_resume_tailor_graph(checkpointer=None, store=None):
    return _build_graph("resume-tailor", checkpointer, store)


def build_apply_copilot_graph(checkpointer=None, store=None):
    return _build_graph("apply-copilot", checkpointer, store)


def build_connection_scout_graph(checkpointer=None, store=None):
    return _build_graph("connection-scout", checkpointer, store)


# Short factory names keep the registry easy to consume from later specialist tooling.
build_feed_curator = build_feed_curator_graph
build_resume_tailor = build_resume_tailor_graph
build_apply_copilot = build_apply_copilot_graph
build_connection_scout = build_connection_scout_graph


_FACTORIES = {
    "feed-curator": build_feed_curator_graph,
    "resume-tailor": build_resume_tailor_graph,
    "apply-copilot": build_apply_copilot_graph,
    "connection-scout": build_connection_scout_graph,
}


def build_registry(checkpointer=None, store=None):
    """Compile one graph per specialist id and return the id-to-graph registry."""
    return {
        agent_id: _FACTORIES[agent_id](checkpointer=checkpointer, store=store)
        for agent_id in AGENT_IDS
    }

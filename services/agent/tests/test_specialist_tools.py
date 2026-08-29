"""Behavioral tests for assistant specialist tools invoking registry graphs (#256)."""

import json

import pytest

from app.graph.registry import build_registry


@pytest.mark.anyio
async def test_four_tools_with_expected_names():
    from app.agents.specialist_tools import create_specialist_tools

    tools = create_specialist_tools(user_id="user_123")
    names = [t.name for t in tools]
    assert names == [
        "run_feed_curation",
        "tailor_resume",
        "build_application_pack",
        "scout_connections",
    ]


@pytest.mark.anyio
async def test_tool_invokes_registry_stub():
    from app.agents.specialist_tools import create_specialist_tools

    registry = build_registry()
    tools = create_specialist_tools(user_id="u1", registry=registry)

    feed_tool = tools[0]
    raw_res = await feed_tool.ainvoke({"query": "python jobs"})
    res = json.loads(raw_res) if isinstance(raw_res, str) else raw_res

    assert res.get("status") == "done"
    assert "output" in res
    assert res["output"]["agent_id"] == "feed-curator"
    assert res["output"]["echo"] == {"query": "python jobs"}


@pytest.mark.anyio
async def test_missing_registry_entry_fails_closed():
    from app.agents.specialist_tools import create_specialist_tools

    # Registry missing the feed-curator agent
    tools = create_specialist_tools(user_id="u1", registry={})
    feed_tool = tools[0]

    raw_res = await feed_tool.ainvoke({"query": "python jobs"})
    res = json.loads(raw_res) if isinstance(raw_res, str) else raw_res

    assert "error" in res
    assert (
        "not available" in res["error"].lower()
        or "not found" in res["error"].lower()
        or "missing" in res["error"].lower()
    )


@pytest.mark.anyio
async def test_interrupt_returns_awaiting_approval():
    from app.agents.specialist_tools import create_specialist_tools

    class _InterruptGraph:
        async def ainvoke(self, payload, config=None):
            return {
                "__interrupt__": ("approval_needed",),
                "status": "awaiting_approval",
                "output": {"draft": "sample draft"},
            }

    fake_registry = {"resume-tailor": _InterruptGraph()}
    tools = create_specialist_tools(user_id="u1", registry=fake_registry)
    tailor_tool = [t for t in tools if t.name == "tailor_resume"][0]

    raw_res = await tailor_tool.ainvoke({"job_id": "job_1"})
    res = json.loads(raw_res) if isinstance(raw_res, str) else raw_res

    assert res.get("status") == "awaiting_approval"
    assert "thread_id" in res
    assert res["thread_id"].startswith("u1:resume-tailor:chat-")


@pytest.mark.anyio
async def test_thread_id_format():
    from app.agents.specialist_tools import make_chat_tool_thread_id

    thread_id = make_chat_tool_thread_id("user_42", "apply-copilot")
    assert thread_id.startswith("user_42:apply-copilot:chat-")
    # Suffix should be unique / non-empty
    suffix = thread_id.split("user_42:apply-copilot:chat-")[1]
    assert len(suffix) >= 4

"""The assistant paths must be traced like every other LLM entrypoint (#200).

`/parse-job`, `/score-fit`, `/draft-outreach` and the Phase-8 agents all build a
`traced_config(...)`. The four `/assistant/*` endpoints — the newest and most-used
surface — built a bare `{"configurable": {...}}` and were invisible in Langfuse.

Tracing must be added *without* dropping `configurable.thread_id`, which is what the
durable HITL checkpointer keys resume-after-interrupt on.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main


@pytest.fixture
def traced(monkeypatch):
    """Force tracing on and capture the config each assistant path builds."""
    seen: list[dict] = []

    def fake_traced_config(name, session_id=None, user_id=None):
        metadata = {}
        if session_id:
            metadata["langfuse_session_id"] = session_id
        if user_id:
            metadata["langfuse_user_id"] = user_id
        return {"callbacks": ["handler"], "run_name": name, "metadata": metadata}

    monkeypatch.setattr(main, "traced_config", fake_traced_config)
    monkeypatch.setattr(main, "llm_available", lambda: True)

    class _FakeGraph:
        async def ainvoke(self, _payload, config=None):
            seen.append(config)
            return {"messages": [], "fit": None, "__interrupt__": None}

        async def aget_state(self, _config):
            class _S:
                values: dict = {}
                next: tuple = ()

            return _S()

    monkeypatch.setattr(main, "_get_assistant_graph", lambda: _FakeGraph())
    return seen


def _config_for(seen: list[dict]) -> dict:
    assert seen, "the assistant path never invoked the graph"
    return seen[-1]


def test_assistant_run_is_traced(traced):
    with TestClient(main.app) as client:
        client.post(
            "/assistant/run",
            json={
                "description_text": "jd",
                "resume_text": "cv",
                "profile_text": "",
                "user_id": "u1",
            },
        )

    config = _config_for(traced)
    assert config["run_name"] == "assistant-run"
    assert config["callbacks"] == ["handler"]
    assert config["metadata"]["langfuse_user_id"] == "u1"
    # The checkpointer key must survive the merge, or resume-after-interrupt breaks.
    thread_id = config["configurable"]["thread_id"]
    assert thread_id
    # ...and it must also group the Langfuse traces: run + resume of one HITL flow are
    # separate HTTP requests, so without a session id resume is an orphan root (#204).
    assert config["metadata"]["langfuse_session_id"] == thread_id


def test_assistant_resume_is_traced_and_keeps_its_thread(traced):
    with TestClient(main.app) as client:
        client.post("/assistant/resume", json={"thread_id": "thread-42", "approved": True})

    config = _config_for(traced)
    assert config["run_name"] == "assistant-resume"
    assert config["callbacks"] == ["handler"]
    assert config["configurable"]["thread_id"] == "thread-42"
    # Resume must land in the same Langfuse session as its original run.
    assert config["metadata"]["langfuse_session_id"] == "thread-42"


def test_tracing_never_clobbers_configurable(monkeypatch):
    """A traced_config that itself carried `configurable` must not win over thread_id."""
    monkeypatch.setattr(
        main,
        "traced_config",
        lambda *a, **k: {"callbacks": ["h"], "configurable": {"thread_id": "WRONG"}},
    )
    merged = main._traced_graph_config("assistant-run", thread_id="RIGHT", user_id=None)
    assert merged["configurable"]["thread_id"] == "RIGHT"


def test_untraced_config_still_yields_a_usable_graph_config(monkeypatch):
    """Tracing disabled -> traced_config returns {}; the graph config must still work."""
    monkeypatch.setattr(main, "traced_config", lambda *a, **k: {})

    merged = main._traced_graph_config("assistant-run", thread_id="t1", user_id="u1")

    assert merged == {"configurable": {"thread_id": "t1"}}

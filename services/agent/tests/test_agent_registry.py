"""Behavioral tests for the specialist graph registry and generic routes."""

from fastapi.testclient import TestClient

import app.main as main
from app.config import settings
from app.graph.registry import AGENT_IDS, build_registry, make_thread_id


def test_registry_has_exactly_the_four_specialist_ids():
    assert AGENT_IDS == ("feed-curator", "resume-tailor", "apply-copilot", "connection-scout")
    registry = build_registry()
    assert set(registry) == set(AGENT_IDS)
    assert len({id(graph) for graph in registry.values()}) == 4


def test_thread_id_is_user_agent_and_optional_job_scoped():
    assert make_thread_id("u1", "feed-curator") == "u1:feed-curator"
    assert make_thread_id("u1", "feed-curator", "job-7") == "u1:feed-curator:job-7"


def test_keyless_echo_stream_returns_status_and_result(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", None)
    with TestClient(main.app) as client:
        response = client.post(
            "/agents/feed-curator/stream",
            json={"user_id": "u1", "job_id": "job-7", "input": {"query": "python"}},
        )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: status" in response.text
    assert '"status": "done"' in response.text
    assert "event: result" in response.text
    assert '"agent_id": "feed-curator"' in response.text
    assert '"echo": {"query": "python"}' in response.text


def test_unknown_agent_is_404_before_stream(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", None)
    with TestClient(main.app) as client:
        response = client.post("/agents/not-an-agent/stream", json={"user_id": "u1", "input": {}})
    assert response.status_code == 404


def test_lifespan_builds_and_clears_specialist_registry(monkeypatch):
    built = {}
    sentinel = {"feed-curator": object()}

    def fake_build(**kwargs):
        built["kwargs"] = kwargs
        return sentinel

    monkeypatch.setattr(main, "build_registry", fake_build)
    main._agent_registry = None
    with TestClient(main.app):
        assert main._agent_registry is sentinel
        assert "checkpointer" in built["kwargs"]
    assert main._agent_registry is None


def test_resume_stream_passes_command_payload_and_thread_id_to_graph(monkeypatch):
    captured = {}

    class FakeState:
        values = {"status": "done", "output": {"agent_id": "feed-curator"}}

    class FakeGraph:
        async def astream(self, payload, config, stream_mode=None):
            captured["payload"] = payload
            captured["config"] = config
            yield {"echo": {"status": "done"}}

        async def aget_state(self, config):
            return FakeState()

    monkeypatch.setattr(settings, "agent_api_key", None)
    monkeypatch.setattr(main, "build_registry", lambda **_kwargs: {"feed-curator": FakeGraph()})
    with TestClient(main.app) as client:
        response = client.post(
            "/agents/feed-curator/resume",
            json={"thread_id": "u1:feed-curator:job-7", "payload": {"approved": True}},
        )
    assert response.status_code == 200
    assert "event: result" in response.text
    assert captured["payload"].resume == {"approved": True}
    assert captured["config"]["configurable"]["thread_id"] == "u1:feed-curator:job-7"


def test_agent_routes_require_the_shared_key(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", "secret")
    with TestClient(main.app) as client:
        assert client.post("/agents/feed-curator/stream", json={"user_id": "u1"}).status_code == 401
        assert (
            client.post(
                "/agents/feed-curator/stream",
                json={"user_id": "u1"},
                headers={"Authorization": "Bearer wrong"},
            ).status_code
            == 401
        )
        response = client.post(
            "/agents/feed-curator/stream",
            json={"user_id": "u1"},
            headers={"Authorization": "Bearer secret"},
        )
    assert response.status_code == 200

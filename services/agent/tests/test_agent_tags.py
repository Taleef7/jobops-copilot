"""Behavioral tests for per-agent Langfuse observability tags (#255)."""

from fastapi.testclient import TestClient

import app.main as main
from app.config import settings
from app.obs import langfuse as lf


def test_agent_tags_mapping_constants():
    from app.obs.agent_tags import AGENT_TAGS

    assert AGENT_TAGS["feed-curator"] == ["feed"]
    assert AGENT_TAGS["resume-tailor"] == ["tailor"]
    assert AGENT_TAGS["apply-copilot"] == ["apply"]
    assert AGENT_TAGS["connection-scout"] == ["scout"]


def test_tags_for_and_get_agent_tags():
    from app.obs.agent_tags import get_agent_tags, tags_for

    assert tags_for("feed-curator") == ["feed"]
    assert tags_for("resume-tailor") == ["tailor"]
    assert tags_for("apply-copilot") == ["apply"]
    assert tags_for("connection-scout") == ["scout"]
    assert tags_for("unknown-agent") == ["unknown-agent"]

    assert get_agent_tags("feed-curator") == ["feed"]
    assert get_agent_tags("unknown-agent") == ["unknown-agent"]


def test_traced_config_attaches_tags_when_enabled(monkeypatch):
    monkeypatch.setattr(settings, "langfuse_public_key", "pk")
    monkeypatch.setattr(settings, "langfuse_secret_key", "sk")
    monkeypatch.setattr(lf, "_handler", lambda: object())

    config = lf.traced_config("feed-run", tags=["feed"])
    assert "tags" in config
    assert config["tags"] == ["feed"]
    assert config["metadata"]["langfuse_tags"] == ["feed"]


def test_traced_config_omits_tags_when_none(monkeypatch):
    monkeypatch.setattr(settings, "langfuse_public_key", "pk")
    monkeypatch.setattr(settings, "langfuse_secret_key", "sk")
    monkeypatch.setattr(lf, "_handler", lambda: object())

    config = lf.traced_config("feed-run")
    assert "tags" not in config


def test_traced_config_returns_empty_dict_when_disabled(monkeypatch):
    monkeypatch.setattr(settings, "langfuse_public_key", None)
    monkeypatch.setattr(settings, "langfuse_secret_key", None)

    assert lf.traced_config("feed-run", tags=["feed"]) == {}


def test_specialist_stream_passes_agent_tags_in_config(monkeypatch):
    captured = {}

    class FakeGraph:
        async def astream(self, payload, config, stream_mode=None):
            captured["config"] = config
            yield {"echo": {"status": "done"}}

        async def aget_state(self, config):
            class _S:
                values = {"status": "done", "output": {"agent_id": "feed-curator"}}

            return _S()

    monkeypatch.setattr(settings, "agent_api_key", None)
    monkeypatch.setattr(settings, "langfuse_public_key", "pk")
    monkeypatch.setattr(settings, "langfuse_secret_key", "sk")
    monkeypatch.setattr(lf, "_handler", lambda: object())
    monkeypatch.setattr(main, "build_registry", lambda **_kwargs: {"feed-curator": FakeGraph()})

    with TestClient(main.app) as client:
        response = client.post(
            "/agents/feed-curator/stream",
            json={"user_id": "u1", "job_id": "job-1", "input": {}},
        )

    assert response.status_code == 200
    assert "tags" in captured["config"]
    assert captured["config"]["tags"] == ["feed"]


def test_specialist_resume_passes_agent_tags_in_config(monkeypatch):
    captured = {}

    class FakeGraph:
        async def astream(self, payload, config, stream_mode=None):
            captured["config"] = config
            yield {"echo": {"status": "done"}}

        async def aget_state(self, config):
            class _S:
                values = {"status": "done", "output": {"agent_id": "resume-tailor"}}

            return _S()

    monkeypatch.setattr(settings, "agent_api_key", None)
    monkeypatch.setattr(settings, "langfuse_public_key", "pk")
    monkeypatch.setattr(settings, "langfuse_secret_key", "sk")
    monkeypatch.setattr(lf, "_handler", lambda: object())
    monkeypatch.setattr(main, "build_registry", lambda **_kwargs: {"resume-tailor": FakeGraph()})

    with TestClient(main.app) as client:
        response = client.post(
            "/agents/resume-tailor/resume",
            json={"thread_id": "u1:resume-tailor:job-1", "payload": {"approved": True}},
        )

    assert response.status_code == 200
    assert "tags" in captured["config"]
    assert captured["config"]["tags"] == ["tailor"]

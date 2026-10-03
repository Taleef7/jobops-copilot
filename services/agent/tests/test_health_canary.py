"""Health surface and LLM canary (#348).

The public /health says only that the process is up; the model, provider and build SHA
move behind the shared key, and /health/llm makes one tiny real model call so a broken
model can't go unnoticed again (gpt-6-luna failed every call for 6 days).
"""

import re
from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main
from app.config import Settings, settings

client = TestClient(main.app)
KEY = "s3cret-shared-key"
AUTH = {"X-Agent-Key": KEY}


def test_public_health_says_only_ok(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_health_details_needs_the_key(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    monkeypatch.setattr(main, "llm_available", lambda: True)
    monkeypatch.setattr(main, "resolve_provider", lambda: "openai")
    assert client.get("/health/details").status_code == 401

    body = client.get("/health/details", headers=AUTH).json()
    assert body["provider"] == "openai"
    assert body["model"] == settings.openai_model
    # #410: what is sent, so a model switch that didn't apply can't look green.
    assert body["reasoning_effort"] == "medium"
    assert body["api"] == "responses"
    assert body["llm_configured"] is True
    # The drift-check workflow compares this to the latest agent commit.
    assert "build_sha" in body


def test_openapi_needs_the_key(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    assert client.get("/openapi.json").status_code == 401
    assert client.get("/openapi.json", headers=AUTH).status_code == 200


def test_llm_canary_needs_the_key(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    called = []
    monkeypatch.setattr(main, "run_llm_canary", lambda: called.append(1))
    assert client.get("/health/llm").status_code == 401
    assert called == [], "an unauthenticated request must never reach the paid model call"


def test_llm_canary_reports_a_working_model(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    monkeypatch.setattr(main, "llm_available", lambda: True)
    monkeypatch.setattr(main, "resolve_provider", lambda: "openai")
    monkeypatch.setattr(main, "run_llm_canary", lambda: None)

    res = client.get("/health/llm", headers=AUTH)

    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["model"] == settings.openai_model
    assert body["reasoning_effort"] == "medium"
    assert body["api"] == "responses"
    assert isinstance(body["latency_ms"], int)


def test_llm_canary_reports_the_provider_error(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    monkeypatch.setattr(main, "llm_available", lambda: True)
    monkeypatch.setattr(main, "resolve_provider", lambda: "openai")

    def broken():
        raise RuntimeError("Function tools with reasoning_effort are not supported for gpt-6-luna")

    monkeypatch.setattr(main, "run_llm_canary", broken)

    res = client.get("/health/llm", headers=AUTH)

    assert res.status_code == 503
    body = res.json()
    assert body["ok"] is False
    assert "gpt-6-luna" in body["error"]


def test_llm_canary_without_a_provider_is_503(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    monkeypatch.setattr(main, "llm_available", lambda: False)

    res = client.get("/health/llm", headers=AUTH)

    assert res.status_code == 503
    assert res.json()["ok"] is False


def test_default_model_matches_the_bicep_default():
    # #329 changed the model in one place and it broke every call. The agent's default and
    # the infra default must name the same model.
    repo = Path(__file__).resolve().parents[3]
    bicep = (repo / "infra" / "main.bicep").read_text(encoding="utf-8")
    match = re.search(r"param\s+openAiModel\s+string\s*=\s*'([^']+)'", bicep)
    assert match, "openAiModel param not found in infra/main.bicep"
    assert Settings(_env_file=None).openai_model == match.group(1)


def test_health_reports_the_old_call_for_a_rollback_model(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    monkeypatch.setattr(main, "llm_available", lambda: True)
    monkeypatch.setattr(main, "resolve_provider", lambda: "openai")
    monkeypatch.setattr(settings, "openai_model", "gpt-5.4-nano")

    body = client.get("/health/details", headers=AUTH).json()

    assert body["model"] == "gpt-5.4-nano"
    assert body["reasoning_effort"] is None
    assert body["api"] == "chat"


def test_default_effort_matches_the_bicep_default_and_the_env_example():
    # #410: the model and its effort are set in config.py, infra/main.bicep (which writes
    # them into the container's env) and .env.example; all three must agree.
    repo = Path(__file__).resolve().parents[3]
    bicep = (repo / "infra" / "main.bicep").read_text(encoding="utf-8")
    defaults = Settings(_env_file=None)
    match = re.search(r"param\s+openAiReasoningEffort\s+string\s*=\s*'([^']*)'", bicep)
    assert match, "openAiReasoningEffort param not found in infra/main.bicep"
    assert defaults.openai_reasoning_effort == match.group(1)
    assert re.search(
        r"name:\s*'OPENAI_REASONING_EFFORT'\s*value:\s*openAiReasoningEffort", bicep
    ), "OPENAI_REASONING_EFFORT is not written into the container's env"

    example = (repo / "services" / "agent" / ".env.example").read_text(encoding="utf-8")
    assert f"OPENAI_MODEL={defaults.openai_model}\n" in example
    assert f"OPENAI_REASONING_EFFORT={defaults.openai_reasoning_effort}\n" in example

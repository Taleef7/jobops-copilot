"""Server-to-server auth middleware tests (QA·A).

Proves the previously-open agent rejects unauthenticated calls once AGENT_API_KEY
is set, while keeping the health/docs probe paths open and staying a no-op when
no key is configured.
"""

import pytest
from fastapi.testclient import TestClient

import app.auth as auth
import app.main as main
from app.config import settings

client = TestClient(main.app)

KEY = "s3cret-shared-key"


def test_auth_disabled_when_key_unset(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", None)
    # No Authorization header, yet a protected path is reachable (mock fallback story).
    res = client.post("/rag/search", json={"query": "x"})
    assert res.status_code != 401


def test_protected_path_rejected_without_key(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    res = client.post("/rag/search", json={"query": "x", "user_id": "victim"})
    assert res.status_code == 401


def test_protected_path_rejected_with_wrong_key(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    res = client.post(
        "/rag/search",
        json={"query": "x"},
        headers={"Authorization": "Bearer not-the-key"},
    )
    assert res.status_code == 401


def test_protected_path_allowed_with_bearer_key(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    monkeypatch.setattr(main, "rag_available", lambda: False)  # short-circuit to 503, past auth
    res = client.post(
        "/rag/search",
        json={"query": "x"},
        headers={"Authorization": f"Bearer {KEY}"},
    )
    assert res.status_code != 401


def test_protected_path_allowed_with_x_agent_key(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    monkeypatch.setattr(main, "rag_available", lambda: False)
    res = client.post("/rag/search", json={"query": "x"}, headers={"X-Agent-Key": KEY})
    assert res.status_code != 401


def test_health_exempt_without_key(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    assert client.get("/health").status_code == 200


def test_openapi_exempt_without_key(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    assert client.get("/openapi.json").status_code == 200


def test_docs_explorer_not_exempt(monkeypatch):
    # The rendered doc UI must NOT be browsable unauthenticated (attack-surface).
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    assert client.get("/docs").status_code == 401
    assert client.get("/redoc").status_code == 401


def test_unknown_path_fails_closed(monkeypatch):
    # Any path outside the route table AND the public allowlist must be denied.
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    assert auth.is_authorized("/some/unmapped/route", {}) is False


def test_extract_key_tolerates_extra_whitespace():
    assert auth.extract_key({"authorization": f"Bearer  {KEY}"}) == KEY  # two spaces
    assert auth.extract_key({"authorization": f"bearer {KEY}"}) == KEY  # lowercase scheme


def test_is_authorized_unit(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    assert auth.is_authorized("/rag/search", {"authorization": f"Bearer {KEY}"}) is True
    assert auth.is_authorized("/rag/search", {"authorization": "Bearer wrong"}) is False
    assert auth.is_authorized("/rag/search", {}) is False  # length mismatch handled
    assert auth.is_authorized("/health", {}) is True  # exempt
    assert auth.is_authorized("/docs", {}) is False  # doc UI not exempt
    monkeypatch.setattr(settings, "agent_api_key", None)
    assert auth.is_authorized("/rag/search", {}) is True  # disabled


def test_extract_key_unit():
    assert auth.extract_key({"authorization": f"Bearer {KEY}"}) == KEY
    assert auth.extract_key({"x-agent-key": KEY}) == KEY
    assert auth.extract_key({}) is None


def test_is_production_runtime_detects_cloud(monkeypatch):
    monkeypatch.delenv("CONTAINER_APP_NAME", raising=False)
    monkeypatch.delenv("WEBSITE_SITE_NAME", raising=False)
    assert auth.is_production_runtime() is False
    monkeypatch.setenv("WEBSITE_SITE_NAME", "jobops-agent")
    assert auth.is_production_runtime() is True


def test_assert_auth_configured_raises_in_cloud_without_key(monkeypatch):
    # The public Container App must refuse to start with auth disabled.
    monkeypatch.setenv("CONTAINER_APP_NAME", "jobops-agent")
    monkeypatch.setattr(settings, "agent_api_key", None)
    with pytest.raises(RuntimeError):
        auth.assert_auth_configured()


def test_assert_auth_configured_ok_in_cloud_with_key(monkeypatch):
    monkeypatch.setenv("CONTAINER_APP_NAME", "jobops-agent")
    monkeypatch.setattr(settings, "agent_api_key", KEY)
    auth.assert_auth_configured()  # no raise


def test_assert_auth_configured_ok_locally_without_key(monkeypatch):
    monkeypatch.delenv("CONTAINER_APP_NAME", raising=False)
    monkeypatch.delenv("WEBSITE_SITE_NAME", raising=False)
    monkeypatch.setattr(settings, "agent_api_key", None)
    auth.assert_auth_configured()  # no raise

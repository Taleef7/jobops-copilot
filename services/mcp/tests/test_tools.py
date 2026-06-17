"""Phase 3 · L — MCP REST-bridge tools (mocked API; no live server)."""

import json

import httpx

import api_client


def _mock(handler):
    return httpx.MockTransport(handler)


def test_search_jobs_forwards_auth_and_filters(monkeypatch):
    monkeypatch.setenv("MCP_SERVER_API_KEY", "svc-secret")
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return httpx.Response(
            200,
            json={
                "jobs": [
                    {"id": "1", "title": "AI Engineer", "company": "Acme"},
                    {"id": "2", "title": "Data Scientist", "company": "Globex"},
                ]
            },
        )

    monkeypatch.setattr(api_client, "_transport", _mock(handler))
    jobs = api_client.search_jobs("u_mcp", query="engineer")
    assert captured["headers"]["x-api-key"] == "svc-secret"
    assert captured["headers"]["x-user-id"] == "u_mcp"
    assert [j["id"] for j in jobs] == ["1"]  # filtered to the AI Engineer role


def test_get_job(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/jobs/abc"
        return httpx.Response(200, json={"job": {"id": "abc"}})

    monkeypatch.setattr(api_client, "_transport", _mock(handler))
    assert api_client.get_job("u", "abc")["id"] == "abc"


def test_list_saved_searches(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/saved-searches"
        return httpx.Response(200, json={"savedSearches": [{"id": "s1"}]})

    monkeypatch.setattr(api_client, "_transport", _mock(handler))
    assert api_client.list_saved_searches("u")[0]["id"] == "s1"


def test_score_fit_posts_job_id(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST" and request.url.path == "/api/ai/score-fit"
        assert json.loads(request.content)["job_id"] == "j1"
        return httpx.Response(200, json={"fit_score": 80})

    monkeypatch.setattr(api_client, "_transport", _mock(handler))
    assert api_client.score_fit("u", "j1")["fit_score"] == 80


def test_draft_outreach_posts_payload(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content) == {"job_id": "j1", "message_type": "recruiter_email"}
        return httpx.Response(200, json={"draft_text": "hi"})

    monkeypatch.setattr(api_client, "_transport", _mock(handler))
    assert api_client.draft_outreach("u", "j1")["draft_text"] == "hi"


def test_server_registers_tools():
    # Importing the server constructs the FastMCP app and runs the @mcp.tool decorators.
    import server

    assert server.mcp is not None

"""Phase 3 · N — agent-as-MCP-client tool loading + Tavily fallback (no network)."""

from app.agents import mcp_tools
from app.agents.tools import web_search


def test_falls_back_to_tavily_without_config(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "mcp_client_servers", None)
    mcp_tools.reset_mcp_tools_cache()
    assert mcp_tools.load_research_tools() == [web_search]


def test_uses_external_mcp_tools_when_available(monkeypatch):
    mcp_tools.reset_mcp_tools_cache()
    monkeypatch.setattr(mcp_tools, "_load_external_mcp_tools", lambda: ["mcp_a", "mcp_b"])
    assert mcp_tools.load_research_tools() == ["mcp_a", "mcp_b"]


def test_caches_successful_load(monkeypatch):
    mcp_tools.reset_mcp_tools_cache()
    calls = {"n": 0}

    def fake():
        calls["n"] += 1
        return ["t"]

    monkeypatch.setattr(mcp_tools, "_load_external_mcp_tools", fake)
    mcp_tools.load_research_tools()
    mcp_tools.load_research_tools()
    assert calls["n"] == 1  # cached after the first successful load


def test_does_not_cache_fallback(monkeypatch):
    mcp_tools.reset_mcp_tools_cache()
    monkeypatch.setattr(mcp_tools, "_load_external_mcp_tools", lambda: None)
    assert mcp_tools.load_research_tools() == [web_search]
    # later a sync context succeeds → MCP tools are used (fallback was not cached)
    monkeypatch.setattr(mcp_tools, "_load_external_mcp_tools", lambda: ["mcp_a"])
    assert mcp_tools.load_research_tools() == ["mcp_a"]


def test_research_agent_uses_loaded_tools(monkeypatch):
    from app.agents import runner
    from app.schemas import ResearchBrief, ResearchRequest

    captured: dict = {}

    class _FakeAgent:
        def invoke(self, payload, config=None):
            return {"messages": [], "structured_response": ResearchBrief()}

    def fake_create_agent(model, tools, system_prompt, response_format):
        captured["tools"] = tools
        return _FakeAgent()

    monkeypatch.setattr(runner, "create_agent", fake_create_agent)
    monkeypatch.setattr(runner, "get_model", lambda: (object(), "fake"))
    monkeypatch.setattr(runner, "load_research_tools", lambda: ["sentinel_tool"])

    runner.run_research(ResearchRequest(company="Acme"))
    assert captured["tools"] == ["sentinel_tool"]

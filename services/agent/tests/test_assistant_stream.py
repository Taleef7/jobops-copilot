"""Phase 3 · M — SSE streaming of the assistant run (no LLM; fake graph)."""

from fastapi.testclient import TestClient

import app.main as main

client = TestClient(main.app)


class _FakeState:
    def __init__(self, values):
        self.values = values


class _FakeGraph:
    def __init__(self, with_interrupt: bool):
        self._with_interrupt = with_interrupt

    async def astream(self, payload, config, stream_mode=None):
        yield {"parse": {"status": "parsed"}}
        yield {"score": {"status": "scored"}}
        if self._with_interrupt:
            yield {"research": {"status": "researched"}}
            yield {"__interrupt__": ("approve_outreach",)}
        else:
            yield {"pass": {"status": "passed"}}

    async def aget_state(self, config):
        return _FakeState({"fit": {"fit_score": 80}, "research": {"company_summary": "ok"}})


def test_stream_503_without_provider(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: False)
    res = client.post("/assistant/stream", json={"description_text": "d"})
    assert res.status_code == 503


def test_stream_emits_status_then_awaiting_approval(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: True)
    monkeypatch.setattr(main, "_get_assistant_graph", lambda: _FakeGraph(with_interrupt=True))

    res = client.post("/assistant/stream", json={"description_text": "d", "resume_text": "r"})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    body = res.text
    assert "event: status" in body and '"node": "parse"' in body
    assert "event: awaiting_approval" in body
    assert "event: result" not in body  # paused at the interrupt


def test_stream_weak_fit_emits_result(monkeypatch):
    monkeypatch.setattr(main, "llm_available", lambda: True)
    monkeypatch.setattr(main, "_get_assistant_graph", lambda: _FakeGraph(with_interrupt=False))

    res = client.post("/assistant/stream", json={"description_text": "d"})
    assert res.status_code == 200
    assert "event: result" in res.text
    assert "event: awaiting_approval" not in res.text

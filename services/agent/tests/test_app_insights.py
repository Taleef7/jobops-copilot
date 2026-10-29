import os

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind

from app.main import _configure_app_insights, _trace_requests

_CONN = "InstrumentationKey=00000000-0000-0000-0000-000000000000"


def test_configure_app_insights_noop_without_conn_string(monkeypatch):
    monkeypatch.delenv("APPLICATIONINSIGHTS_CONNECTION_STRING", raising=False)
    assert _configure_app_insights() is False


def _configure(monkeypatch) -> dict:
    """Run the setup with Azure Monitor stubbed; returns the service name it saw."""
    seen: dict = {}
    monkeypatch.setenv("APPLICATIONINSIGHTS_CONNECTION_STRING", _CONN)
    monkeypatch.setattr(
        "azure.monitor.opentelemetry.configure_azure_monitor",
        lambda **_: seen.update(name=os.environ.get("OTEL_SERVICE_NAME")),
    )
    assert _configure_app_insights() is True
    return seen


def test_the_agent_reports_as_jobops_agent(monkeypatch):
    # Without a name, App Insights showed the agent as "unknown_service:python3.12".
    # Set, then delete: monkeypatch puts the variable back as it was (unset) afterwards.
    monkeypatch.setenv("OTEL_SERVICE_NAME", "placeholder")
    monkeypatch.delenv("OTEL_SERVICE_NAME")
    assert _configure(monkeypatch) == {"name": "jobops-agent"}


def test_a_service_name_set_outside_is_kept(monkeypatch):
    monkeypatch.setenv("OTEL_SERVICE_NAME", "jobops-agent-staging")
    assert _configure(monkeypatch) == {"name": "jobops-agent-staging"}


def _spans(path: str) -> list:
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    probe = FastAPI()
    probe.get("/health")(lambda: {"ok": True})
    probe.get("/health/llm")(lambda: {"ok": True})
    probe.get("/fit-score")(lambda: {"ok": True})
    probe.get("/stream")(lambda: StreamingResponse(f"data: {i}\n\n" for i in range(20)))
    assert _trace_requests(probe, tracer_provider=provider) is True
    try:
        TestClient(probe).get(path)
    finally:
        FastAPIInstrumentor.uninstrument_app(probe)
    return list(exporter.get_finished_spans())


def _server(spans: list) -> list:
    return [span for span in spans if span.kind is SpanKind.SERVER]


def test_each_request_is_traced():
    # configure_azure_monitor() traces FastAPI by swapping the class, but main.py builds its app
    # from the class it imported first: no request reached App Insights.
    assert len(_server(_spans("/fit-score"))) == 1
    assert len(_server(_spans("/health/llm"))) == 1


def test_the_liveness_probe_is_not_traced():
    assert _spans("/health") == []


def test_a_streamed_answer_is_one_span_not_one_per_chunk():
    # Each "http send" would otherwise be its own span: hundreds per chat reply in App Insights.
    spans = _spans("/stream")
    assert len(_server(spans)) == 1
    assert len(spans) == 1, [span.name for span in spans]


def test_an_app_already_traced_another_way_is_reported(caplog):
    # instrument_app would skip it silently, and /health would be traced after all.
    probe = FastAPI()
    assert _trace_requests(probe) is True
    try:
        assert _trace_requests(probe) is False
        assert "already traced" in caplog.text
    finally:
        FastAPIInstrumentor.uninstrument_app(probe)

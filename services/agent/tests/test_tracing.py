"""B2: chains forward the trace config into the underlying .invoke()."""

from app.chains import parse_job as parse_mod
from app.schemas import ParsedJob


class _FakeStructured:
    def __init__(self, sink: dict):
        self._sink = sink

    def invoke(self, messages, config=None):
        self._sink["config"] = config
        return ParsedJob(title="X")


class _FakeModel:
    def __init__(self, sink: dict):
        self._sink = sink

    def with_structured_output(self, _schema):
        return _FakeStructured(self._sink)


def test_parse_job_forwards_trace_config(monkeypatch):
    sink: dict = {}
    monkeypatch.setattr(parse_mod, "get_model", lambda: (_FakeModel(sink), "fake-model"))

    cfg = {"callbacks": ["handler"], "run_name": "parse-job"}
    parse_mod.parse_job("a job description", cfg)

    assert sink["config"] == cfg


def test_parse_job_empty_config_passes_none(monkeypatch):
    sink: dict = {}
    monkeypatch.setattr(parse_mod, "get_model", lambda: (_FakeModel(sink), "fake-model"))

    parse_mod.parse_job("a job description", {})

    assert sink["config"] is None

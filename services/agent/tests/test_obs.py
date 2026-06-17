"""Langfuse obs module: no-op safe + correct config assembly (no SDK needed)."""

import sys
import types

import pytest

from app.config import settings
from app.obs import langfuse as lf


def test_disabled_returns_empty_config(monkeypatch):
    monkeypatch.setattr(settings, "langfuse_public_key", None)
    monkeypatch.setattr(settings, "langfuse_secret_key", None)
    assert lf._enabled() is False
    assert lf.traced_config("parse-job", "sess") == {}


def test_enabled_assembles_callbacks_and_session(monkeypatch):
    monkeypatch.setattr(settings, "langfuse_public_key", "pk")
    monkeypatch.setattr(settings, "langfuse_secret_key", "sk")
    assert lf._enabled() is True

    sentinel = object()
    monkeypatch.setattr(lf, "_handler", lambda: sentinel)

    config = lf.traced_config("score-fit", "sess-123")
    assert config["callbacks"] == [sentinel]
    assert config["run_name"] == "score-fit"
    assert config["metadata"]["langfuse_session_id"] == "sess-123"


def test_enabled_without_session_omits_metadata(monkeypatch):
    monkeypatch.setattr(lf, "_handler", lambda: object())
    config = lf.traced_config("weekly", None)
    assert "metadata" not in config
    assert config["run_name"] == "weekly"


def test_enabled_includes_user_id(monkeypatch):
    monkeypatch.setattr(lf, "_handler", lambda: object())
    config = lf.traced_config("score-fit", user_id="user_42")
    assert config["metadata"]["langfuse_user_id"] == "user_42"
    assert "langfuse_session_id" not in config["metadata"]


def test_traced_span_is_noop_when_disabled(monkeypatch):
    monkeypatch.setattr(settings, "langfuse_public_key", None)
    monkeypatch.setattr(settings, "langfuse_secret_key", None)
    with lf.traced_span("rag.retrieve", k=4) as span:
        assert span is None


def test_traced_span_propagates_body_errors_when_enabled(monkeypatch):
    """A failure in the wrapped work must propagate, not be masked by tracing."""
    monkeypatch.setattr(settings, "langfuse_public_key", "pk")
    monkeypatch.setattr(settings, "langfuse_secret_key", "sk")

    class _FakeSpan:
        def update(self, **_kwargs):
            pass

    class _FakeObservation:
        def __enter__(self):
            return _FakeSpan()

        def __exit__(self, *_exc):
            return False  # never suppress exceptions

    class _FakeClient:
        def start_as_current_observation(self, **_kwargs):
            return _FakeObservation()

    fake_langfuse = types.ModuleType("langfuse")
    fake_langfuse.get_client = lambda: _FakeClient()
    monkeypatch.setitem(sys.modules, "langfuse", fake_langfuse)

    with pytest.raises(ValueError, match="boom"):
        with lf.traced_span("rag.retrieve"):
            raise ValueError("boom")

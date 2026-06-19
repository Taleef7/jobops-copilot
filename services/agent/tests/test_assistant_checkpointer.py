"""QA·D — durable HITL checkpointer wiring + graceful fallback.

The real Postgres saver can't run in CI, so these tests exercise the lifespan
logic around it: durable when DATABASE_URL + build succeed, in-memory fallback
when it's unset or the build fails, and the pool always closed on shutdown.
"""

import asyncio

import pytest
from fastapi.testclient import TestClient

import app.main as main


@pytest.fixture(autouse=True)
def _restore_singleton():
    """Lifespan mutates module globals; isolate each test from the others."""
    graph, pool = main._assistant_graph, main._checkpointer_pool
    main._assistant_graph, main._checkpointer_pool = None, None
    yield
    main._assistant_graph, main._checkpointer_pool = graph, pool


def test_no_database_url_falls_back_to_in_memory(monkeypatch):
    monkeypatch.setattr(main.settings, "database_url", None)
    with TestClient(main.app):
        # Lifespan ran but built nothing durable.
        assert main._assistant_graph is None
        assert main._checkpointer_pool is None
        # The lazy fallback still yields a working (in-memory) graph.
        assert hasattr(main._get_assistant_graph(), "ainvoke")


def test_durable_graph_used_when_available(monkeypatch):
    sentinel_graph = object()

    class _FakePool:
        def __init__(self):
            self.closed = False

        async def close(self):
            self.closed = True

    pool = _FakePool()

    async def _fake_build():
        return sentinel_graph, pool

    monkeypatch.setattr(main.settings, "database_url", "postgresql://x/db")
    monkeypatch.setattr(main, "_build_durable_assistant_graph", _fake_build)

    with TestClient(main.app):
        assert main._assistant_graph is sentinel_graph
        assert main._get_assistant_graph() is sentinel_graph

    # Pool closed and reset on shutdown.
    assert pool.closed is True
    assert main._checkpointer_pool is None


def test_degrades_when_durable_build_fails(monkeypatch):
    async def _boom():
        raise RuntimeError("postgres unreachable")

    monkeypatch.setattr(main.settings, "database_url", "postgresql://x/db")
    monkeypatch.setattr(main, "_build_durable_assistant_graph", _boom)

    with TestClient(main.app) as client:
        # Startup did not crash; service still serves.
        assert client.get("/health").status_code == 200
        # No durable graph -> lazy in-memory fallback applies.
        assert main._assistant_graph is None
        assert main._checkpointer_pool is None


def test_build_closes_pool_when_setup_fails(monkeypatch):
    """If the pool opens but setup() fails, the build must close the pool
    itself — the caller never receives it, so it can't be torn down later."""
    import langgraph.checkpoint.postgres.aio as pg_aio
    import psycopg_pool

    closed = {"value": False}

    class _FakePool:
        def __init__(self, *args, **kwargs):
            pass

        async def open(self):
            pass

        async def close(self):
            closed["value"] = True

    class _FakeSaver:
        def __init__(self, pool):
            pass

        async def setup(self):
            raise RuntimeError("role cannot CREATE TABLE")

    monkeypatch.setattr(main.settings, "database_url", "postgresql://x/db")
    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", _FakePool)
    monkeypatch.setattr(pg_aio, "AsyncPostgresSaver", _FakeSaver)

    with pytest.raises(RuntimeError):
        asyncio.run(main._build_durable_assistant_graph())
    assert closed["value"] is True

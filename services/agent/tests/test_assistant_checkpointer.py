"""Assistant checkpointer wiring after the shared-memory foundation refactor."""

import asyncio

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.config import settings


@pytest.fixture(autouse=True)
def _restore_singletons():
    saved = (
        main._assistant_graph,
        main._checkpointer_pool,
        main._checkpointer_saver,
        main._agent_store,
        main._agent_registry,
    )
    main._assistant_graph = None
    main._checkpointer_pool = None
    main._checkpointer_saver = None
    main._agent_store = None
    main._agent_registry = None
    yield
    (
        main._assistant_graph,
        main._checkpointer_pool,
        main._checkpointer_saver,
        main._agent_store,
        main._agent_registry,
    ) = saved


def test_no_database_url_builds_in_memory_assistant_and_specialists(monkeypatch):
    captured = {}

    monkeypatch.setattr(settings, "database_url", None)
    monkeypatch.setattr(
        main,
        "build_assistant_graph",
        lambda **kwargs: captured.setdefault("assistant", kwargs) or object(),
    )
    monkeypatch.setattr(
        main,
        "build_registry",
        lambda **kwargs: captured.setdefault("registry", kwargs) or {"feed-curator": object()},
    )

    with TestClient(main.app):
        assert main._checkpointer_pool is None
        assert captured["assistant"]["checkpointer"] is captured["registry"]["checkpointer"]
        assert captured["registry"]["store"] is None


def test_durable_saver_is_shared_by_assistant_and_registry(monkeypatch):
    class FakePool:
        def __init__(self):
            self.close_calls = 0

        async def close(self):
            self.close_calls += 1

    pool = FakePool()
    saver = object()
    store = object()
    captured = {}

    async def fake_open(database_url, *, agent_run_setup_on_boot):
        captured["open"] = (database_url, agent_run_setup_on_boot)
        return pool, saver, store

    monkeypatch.setattr(settings, "database_url", "postgresql://x/db")
    monkeypatch.setattr(settings, "agent_run_setup_on_boot", False)
    monkeypatch.setattr(main, "open_durable_backends", fake_open)
    monkeypatch.setattr(
        main,
        "build_assistant_graph",
        lambda **kwargs: captured.setdefault("assistant", kwargs) or object(),
    )
    monkeypatch.setattr(
        main,
        "build_registry",
        lambda **kwargs: captured.setdefault("registry", kwargs) or {"feed-curator": object()},
    )

    with TestClient(main.app):
        assert captured["open"] == ("postgresql://x/db", False)
        assert captured["assistant"] == {"checkpointer": saver}
        assert captured["registry"] == {"checkpointer": saver, "store": store}

    assert pool.close_calls == 1
    assert main._checkpointer_pool is None


def test_configured_database_failure_fails_startup_instead_of_downgrading(monkeypatch):
    async def boom(*_args, **_kwargs):
        raise RuntimeError("postgres unreachable")

    monkeypatch.setattr(settings, "database_url", "postgresql://x/db")
    monkeypatch.setattr(main, "open_durable_backends", boom)

    with pytest.raises(RuntimeError, match="postgres unreachable"):
        with TestClient(main.app):
            pass
    assert main._assistant_graph is None
    assert main._checkpointer_pool is None


def test_open_durable_backends_closes_pool_when_setup_fails(monkeypatch):
    pg_aio = pytest.importorskip("langgraph.checkpoint.postgres.aio")
    store_aio = pytest.importorskip("langgraph.store.postgres.aio")
    psycopg_pool = pytest.importorskip("psycopg_pool")

    closed = {"value": False}

    class FakePool:
        def __init__(self, *args, **kwargs):
            pass

        async def open(self):
            pass

        async def close(self):
            closed["value"] = True

    class FakeSaver:
        def __init__(self, pool, serde=None):
            pass

        async def setup(self):
            raise RuntimeError("role cannot CREATE TABLE")

    class FakeStore:
        def __init__(self, pool):
            pass

    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", FakePool)
    monkeypatch.setattr(pg_aio, "AsyncPostgresSaver", FakeSaver)
    monkeypatch.setattr(store_aio, "AsyncPostgresStore", FakeStore)

    from app.graph.memory import open_durable_backends

    with pytest.raises(RuntimeError, match="role cannot CREATE TABLE"):
        asyncio.run(
            open_durable_backends(
                "postgresql://x/db",
                agent_run_setup_on_boot=True,
            )
        )
    assert closed["value"] is True


def test_open_durable_backends_keeps_strict_msgpack_serializer(monkeypatch):
    pg_aio = pytest.importorskip("langgraph.checkpoint.postgres.aio")
    store_aio = pytest.importorskip("langgraph.store.postgres.aio")
    psycopg_pool = pytest.importorskip("psycopg_pool")

    captured = {}

    class FakePool:
        def __init__(self, *args, **kwargs):
            pass

        async def open(self):
            pass

        async def close(self):
            pass

    class FakeSaver:
        def __init__(self, pool, serde=None):
            captured["serde"] = serde

        async def setup(self):
            pass

    class FakeStore:
        def __init__(self, pool):
            pass

        async def setup(self):
            pass

    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", FakePool)
    monkeypatch.setattr(pg_aio, "AsyncPostgresSaver", FakeSaver)
    monkeypatch.setattr(store_aio, "AsyncPostgresStore", FakeStore)

    from app.graph.memory import open_durable_backends

    asyncio.run(open_durable_backends("postgresql://x/db"))

    from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer

    assert isinstance(captured["serde"], JsonPlusSerializer)
    unsafe_serializer = JsonPlusSerializer(allowed_msgpack_modules=True)
    type_tag, payload = unsafe_serializer.dumps_typed(Exception("untrusted"))
    decoded = captured["serde"].loads_typed((type_tag, payload))
    assert isinstance(decoded, str)
    assert "untrusted" in decoded
    assert not isinstance(decoded, Exception)

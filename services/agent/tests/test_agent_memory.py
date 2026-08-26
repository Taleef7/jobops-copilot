"""Focused tests for durable LangGraph memory and checkpoint maintenance."""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.config import Settings, settings
from app.graph.memory import agent_namespace, profile_namespace


def _run(coro):
    """Use psycopg's supported selector loop on Windows integration runs."""

    if sys.platform == "win32":
        selector_policy = getattr(asyncio, "WindowsSelectorEventLoopPolicy", None)
        if selector_policy is not None:
            previous_policy = asyncio.get_event_loop_policy()
            asyncio.set_event_loop_policy(selector_policy())
            try:
                return asyncio.run(coro)
            finally:
                asyncio.set_event_loop_policy(previous_policy)
    return asyncio.run(coro)


def test_namespaces_preserve_the_platform_contract():
    assert profile_namespace("user-1") == ("user", "user-1", "profile")
    assert agent_namespace("user-1", "resume-tailor") == (
        "user",
        "user-1",
        "resume-tailor",
    )


def test_memory_settings_default_to_setup_and_thirty_day_retention():
    configured = Settings(_env_file=None)

    assert configured.agent_run_setup_on_boot is True
    assert configured.checkpoint_retention_days == 30


def test_memory_settings_read_environment_and_reject_non_positive_retention(monkeypatch):
    monkeypatch.setenv("AGENT_RUN_SETUP_ON_BOOT", "false")
    monkeypatch.setenv("CHECKPOINT_RETENTION_DAYS", "45")

    configured = Settings(_env_file=None)
    assert configured.agent_run_setup_on_boot is False
    assert configured.checkpoint_retention_days == 45

    with pytest.raises(ValueError):
        Settings(_env_file=None, checkpoint_retention_days=0)


def test_open_durable_backends_uses_one_pool_and_runs_both_setups(monkeypatch):
    checkpoint_aio = pytest.importorskip("langgraph.checkpoint.postgres.aio")
    store_aio = pytest.importorskip("langgraph.store.postgres.aio")
    psycopg_pool = pytest.importorskip("psycopg_pool")

    calls: dict[str, object] = {}

    class FakePool:
        def __init__(self, *args, **kwargs):
            calls["pool_args"] = args
            calls["pool_kwargs"] = kwargs
            self.closed = 0

        async def open(self):
            calls["opened"] = True

        async def wait(self):
            calls["waited"] = True

        async def close(self):
            self.closed += 1
            calls["closed"] = self.closed

    class FakeSaver:
        def __init__(self, pool, serde=None):
            calls["saver_pool"] = pool
            calls["serde"] = serde
            self.setup_calls = 0

        async def setup(self):
            self.setup_calls += 1
            calls["saver_setup"] = self.setup_calls

    class FakeStore:
        def __init__(self, pool):
            calls["store_pool"] = pool
            self.setup_calls = 0

        async def setup(self):
            self.setup_calls += 1
            calls["store_setup"] = self.setup_calls

    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", FakePool)
    monkeypatch.setattr(checkpoint_aio, "AsyncPostgresSaver", FakeSaver)
    monkeypatch.setattr(store_aio, "AsyncPostgresStore", FakeStore)

    from app.graph.memory import open_durable_backends

    pool, saver, store = asyncio.run(
        open_durable_backends(
            "postgresql://example/db",
            agent_run_setup_on_boot=True,
        )
    )

    assert calls["opened"] is True
    assert calls["waited"] is True
    assert calls["saver_pool"] is pool
    assert calls["store_pool"] is pool
    assert calls["saver_setup"] == 1
    assert calls["store_setup"] == 1
    assert calls["pool_kwargs"]["open"] is False
    assert calls["pool_kwargs"]["kwargs"]["autocommit"] is True
    assert calls["pool_kwargs"]["kwargs"]["prepare_threshold"] == 0
    unsafe_serializer = calls["serde"].__class__(allowed_msgpack_modules=True)
    type_tag, payload = unsafe_serializer.dumps_typed(Exception("untrusted"))
    decoded = calls["serde"].loads_typed((type_tag, payload))
    assert isinstance(decoded, str)
    assert "untrusted" in decoded
    assert not isinstance(decoded, Exception)
    assert saver is not store


def test_open_durable_backends_waits_for_pool_when_setup_is_disabled(monkeypatch):
    checkpoint_aio = pytest.importorskip("langgraph.checkpoint.postgres.aio")
    store_aio = pytest.importorskip("langgraph.store.postgres.aio")
    psycopg_pool = pytest.importorskip("psycopg_pool")

    calls: list[str] = []

    class FakePool:
        def __init__(self, *args, **kwargs):
            pass

        async def open(self):
            calls.append("open")

        async def wait(self):
            calls.append("wait")

        async def close(self):
            calls.append("close")

    class FakeSaver:
        def __init__(self, pool, serde=None):
            calls.append("saver")

        async def setup(self):
            calls.append("saver_setup")

    class FakeStore:
        def __init__(self, pool):
            calls.append("store")

        async def setup(self):
            calls.append("store_setup")

    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", FakePool)
    monkeypatch.setattr(checkpoint_aio, "AsyncPostgresSaver", FakeSaver)
    monkeypatch.setattr(store_aio, "AsyncPostgresStore", FakeStore)

    from app.graph.memory import open_durable_backends

    asyncio.run(
        open_durable_backends(
            "postgresql://example/db",
            agent_run_setup_on_boot=False,
        )
    )

    assert calls == ["open", "wait", "saver", "store"]


def test_open_durable_backends_closes_pool_when_readiness_fails(monkeypatch):
    checkpoint_aio = pytest.importorskip("langgraph.checkpoint.postgres.aio")
    store_aio = pytest.importorskip("langgraph.store.postgres.aio")
    psycopg_pool = pytest.importorskip("psycopg_pool")

    state = {"closed": 0}

    class FakePool:
        def __init__(self, *args, **kwargs):
            pass

        async def open(self):
            pass

        async def wait(self):
            raise RuntimeError("pool readiness failed")

        async def close(self):
            state["closed"] += 1

    class FakeSaver:
        def __init__(self, pool, serde=None):
            raise AssertionError("backends must not be built before readiness")

    class FakeStore:
        def __init__(self, pool):
            raise AssertionError("backends must not be built before readiness")

    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", FakePool)
    monkeypatch.setattr(checkpoint_aio, "AsyncPostgresSaver", FakeSaver)
    monkeypatch.setattr(store_aio, "AsyncPostgresStore", FakeStore)

    from app.graph.memory import open_durable_backends

    with pytest.raises(RuntimeError, match="pool readiness failed"):
        asyncio.run(
            open_durable_backends(
                "postgresql://example/db",
                agent_run_setup_on_boot=False,
            )
        )

    assert state["closed"] == 1


def test_pruning_counts_rows_without_fetching_deleted_keys():
    from app.graph.memory import _delete_in_batches

    class FakeCursor:
        def __init__(self):
            self.rowcount = 2
            self.execute_calls = 0

        async def execute(self, _statement, _params):
            self.execute_calls += 1
            if self.execute_calls == 2:
                self.rowcount = 0

        async def fetchall(self):
            raise AssertionError("pruning must count on the server, not fetch keys")

    cursor = FakeCursor()
    count = asyncio.run(_delete_in_batches(cursor, "DELETE ...", (), batch_size=2))

    assert count == 2
    assert cursor.execute_calls == 2


def test_pruning_uses_saver_compatible_checkpoint_lock_order():
    from app.graph.memory import prune_checkpoints

    class FakeCursor:
        def __init__(self):
            self.statements = []
            self.rowcount = 0

        async def execute(self, statement, _params=()):
            self.statements.append(statement)

        async def fetchall(self):
            return []

    class CursorContext:
        def __init__(self, cursor):
            self.cursor = cursor

        async def __aenter__(self):
            return self.cursor

        async def __aexit__(self, *_args):
            return False

    class TransactionContext(CursorContext):
        pass

    class FakeConnection:
        def __init__(self, cursor):
            self.cursor_value = cursor

        def transaction(self):
            return TransactionContext(self.cursor_value)

        def cursor(self):
            return CursorContext(self.cursor_value)

    class ConnectionContext:
        def __init__(self, connection):
            self.connection_value = connection

        async def __aenter__(self):
            return self.connection_value

        async def __aexit__(self, *_args):
            return False

    cursor = FakeCursor()
    connection = FakeConnection(cursor)

    class FakePool:
        def connection(self):
            return ConnectionContext(connection)

    asyncio.run(prune_checkpoints(FakePool(), 30))

    lock_statement = cursor.statements[0]
    assert lock_statement.index("checkpoints") < lock_statement.index("checkpoint_blobs")
    assert lock_statement.index("checkpoint_blobs") < lock_statement.index("checkpoint_writes")


@pytest.mark.postgres
def test_postgres_pruning_and_saver_deletion_complete_concurrently():
    if not os.getenv("DATABASE_URL"):
        pytest.skip("needs a real Postgres (DATABASE_URL)")

    from app.graph.memory import open_durable_backends, prune_checkpoints

    async def run():
        thread_id = f"concurrent-delete:{uuid.uuid4().hex}"
        pool, saver, _store = await open_durable_backends(
            os.environ["DATABASE_URL"],
            agent_run_setup_on_boot=True,
        )
        try:
            async with pool.connection() as conn:
                async with conn.transaction():
                    async with conn.cursor() as cur:
                        await cur.execute(
                            """
                            INSERT INTO checkpoints
                                (thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata)
                            VALUES (%s, '', 'checkpoint', %s::jsonb, '{}'::jsonb)
                            """,
                            (
                                thread_id,
                                '{"ts":"2999-01-01T00:00:00+00:00",'
                                '"channel_versions":{}}',
                            ),
                        )

            await asyncio.wait_for(
                asyncio.gather(
                    prune_checkpoints(pool, 30, now=datetime(2025, 1, 1, tzinfo=UTC)),
                    saver.adelete_thread(thread_id),
                ),
                timeout=10,
            )
        finally:
            async with pool.connection() as conn:
                async with conn.transaction():
                    async with conn.cursor() as cur:
                        for table in ("checkpoints", "checkpoint_blobs", "checkpoint_writes"):
                            await cur.execute(
                                f"DELETE FROM {table} WHERE thread_id = %s",
                                (thread_id,),
                            )
            await pool.close()

    _run(run())


def test_open_durable_backends_skips_setup_when_disabled(monkeypatch):
    checkpoint_aio = pytest.importorskip("langgraph.checkpoint.postgres.aio")
    store_aio = pytest.importorskip("langgraph.store.postgres.aio")
    psycopg_pool = pytest.importorskip("psycopg_pool")

    class FakePool:
        def __init__(self, *args, **kwargs):
            self.closed = 0

        async def open(self):
            pass

        async def wait(self):
            pass

        async def close(self):
            self.closed += 1

    class FakeSaver:
        def __init__(self, pool, serde=None):
            self.setup_calls = 0

        async def setup(self):
            self.setup_calls += 1

    class FakeStore(FakeSaver):
        def __init__(self, pool):
            self.setup_calls = 0

    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", FakePool)
    monkeypatch.setattr(checkpoint_aio, "AsyncPostgresSaver", FakeSaver)
    monkeypatch.setattr(store_aio, "AsyncPostgresStore", FakeStore)

    from app.graph.memory import open_durable_backends

    _pool, saver, store = asyncio.run(
        open_durable_backends(
            "postgresql://example/db",
            agent_run_setup_on_boot=False,
        )
    )
    assert saver.setup_calls == 0
    assert store.setup_calls == 0


def test_open_durable_backends_closes_before_propagating_setup_failure(monkeypatch):
    checkpoint_aio = pytest.importorskip("langgraph.checkpoint.postgres.aio")
    store_aio = pytest.importorskip("langgraph.store.postgres.aio")
    psycopg_pool = pytest.importorskip("psycopg_pool")

    state = {"closed": 0}

    class FakePool:
        def __init__(self, *args, **kwargs):
            pass

        async def open(self):
            pass

        async def wait(self):
            pass

        async def close(self):
            state["closed"] += 1

    class FailingSaver:
        def __init__(self, pool, serde=None):
            pass

        async def setup(self):
            raise RuntimeError("setup failed")

    class FakeStore:
        def __init__(self, pool):
            pass

    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", FakePool)
    monkeypatch.setattr(checkpoint_aio, "AsyncPostgresSaver", FailingSaver)
    monkeypatch.setattr(store_aio, "AsyncPostgresStore", FakeStore)

    from app.graph.memory import open_durable_backends

    with pytest.raises(RuntimeError, match="setup failed"):
        asyncio.run(
            open_durable_backends(
                "postgresql://example/db",
                agent_run_setup_on_boot=True,
            )
        )
    assert state["closed"] == 1


def test_lifespan_wires_one_in_memory_saver_without_database(monkeypatch):
    captured: dict[str, object] = {}
    sentinel_registry = {"feed-curator": object()}

    def fake_assistant(**kwargs):
        captured["assistant"] = kwargs
        return object()

    def fake_registry(**kwargs):
        captured["registry"] = kwargs
        return sentinel_registry

    monkeypatch.setattr(settings, "database_url", None)
    monkeypatch.setattr(main, "build_assistant_graph", fake_assistant)
    monkeypatch.setattr(main, "build_registry", fake_registry)

    with TestClient(main.app):
        assert main._agent_registry is sentinel_registry
        assert captured["assistant"]["checkpointer"] is captured["registry"]["checkpointer"]
        assert captured["registry"]["store"] is None
        assert main._checkpointer_pool is None

    assert main._assistant_graph is None
    assert main._agent_registry is None


def test_lifespan_wires_one_durable_saver_and_store(monkeypatch):
    captured: dict[str, object] = {}

    class FakePool:
        def __init__(self):
            self.closed = 0

        async def close(self):
            self.closed += 1

    pool = FakePool()
    saver = object()
    store = object()

    async def fake_open(url, *, agent_run_setup_on_boot):
        captured["open"] = (url, agent_run_setup_on_boot)
        return pool, saver, store

    def fake_assistant(**kwargs):
        captured["assistant"] = kwargs
        return object()

    def fake_registry(**kwargs):
        captured["registry"] = kwargs
        return {"feed-curator": object()}

    monkeypatch.setattr(settings, "database_url", "postgresql://example/db")
    monkeypatch.setattr(settings, "agent_run_setup_on_boot", False)
    monkeypatch.setattr(main, "open_durable_backends", fake_open)
    monkeypatch.setattr(main, "build_assistant_graph", fake_assistant)
    monkeypatch.setattr(main, "build_registry", fake_registry)

    with TestClient(main.app):
        assert captured["open"] == ("postgresql://example/db", False)
        assert captured["assistant"] == {"checkpointer": saver}
        assert captured["registry"] == {"checkpointer": saver, "store": store}
        assert main._checkpointer_pool is pool

    assert pool.closed == 1
    assert main._checkpointer_pool is None


def test_configured_database_startup_failure_propagates_after_pool_cleanup(monkeypatch):
    class FakePool:
        def __init__(self):
            self.closed = 0

        async def close(self):
            self.closed += 1

    pool = FakePool()

    async def fake_open(*_args, **_kwargs):
        return pool, object(), object()

    def boom(**_kwargs):
        raise RuntimeError("graph compilation failed")

    monkeypatch.setattr(settings, "database_url", "postgresql://example/db")
    monkeypatch.setattr(main, "open_durable_backends", fake_open)
    monkeypatch.setattr(main, "build_assistant_graph", boom)

    with pytest.raises(RuntimeError, match="graph compilation failed"):
        with TestClient(main.app):
            pass
    assert pool.closed == 1
    assert main._checkpointer_pool is None


def test_pruning_endpoint_returns_503_without_active_durable_pool(monkeypatch):
    monkeypatch.setattr(settings, "database_url", None)
    with TestClient(main.app) as client:
        response = client.post("/maintenance/prune-checkpoints")

    assert response.status_code == 503
    assert "durable" in response.json()["detail"].lower()


def test_pruning_endpoint_uses_the_existing_auth_middleware(monkeypatch):
    monkeypatch.setattr(settings, "agent_api_key", "secret")
    monkeypatch.setattr(settings, "database_url", None)
    with TestClient(main.app) as client:
        assert client.post("/maintenance/prune-checkpoints").status_code == 401
        response = client.post(
            "/maintenance/prune-checkpoints",
            headers={"Authorization": "Bearer secret"},
        )

    assert response.status_code == 503


def test_pruning_endpoint_delegates_retention_and_counts(monkeypatch):
    captured: dict[str, object] = {}

    class FakePool:
        async def close(self):
            pass

    pool = FakePool()

    async def fake_open(*_args, **_kwargs):
        return pool, object(), object()

    async def fake_prune(active_pool, retention_days):
        captured["args"] = (active_pool, retention_days)
        return {
            "checkpoints_deleted": 2,
            "writes_deleted": 3,
            "blobs_deleted": 4,
            "retention_days": retention_days,
        }

    monkeypatch.setattr(settings, "database_url", "postgresql://example/db")
    monkeypatch.setattr(settings, "checkpoint_retention_days", 9)
    monkeypatch.setattr(main, "open_durable_backends", fake_open)
    monkeypatch.setattr(main, "prune_checkpoints", fake_prune)
    monkeypatch.setattr(main, "build_assistant_graph", lambda **_kwargs: object())
    monkeypatch.setattr(main, "build_registry", lambda **_kwargs: {"feed-curator": object()})

    with TestClient(main.app) as client:
        response = client.post("/maintenance/prune-checkpoints")

    assert response.status_code == 200
    assert response.json() == {
        "checkpoints_deleted": 2,
        "writes_deleted": 3,
        "blobs_deleted": 4,
        "retention_days": 9,
    }
    assert captured["args"] == (pool, 9)


@pytest.mark.postgres
def test_postgres_store_round_trip_in_private_agent_namespace():
    if not os.getenv("DATABASE_URL"):
        pytest.skip("needs a real Postgres (DATABASE_URL)")

    from app.graph.memory import open_durable_backends

    async def run():
        pool, _saver, store = await open_durable_backends(
            os.environ["DATABASE_URL"],
            agent_run_setup_on_boot=True,
        )
        try:
            namespace = agent_namespace("memory-test", "apply-copilot")
            await store.aput(namespace, "round-trip", {"answer": "grounded"})
            item = await store.aget(namespace, "round-trip")
            assert item is not None
            assert item.value == {"answer": "grounded"}
        finally:
            await store.adelete(namespace, "round-trip")
            await pool.close()

    _run(run())


@pytest.mark.postgres
def test_postgres_pruning_preserves_current_checkpoint_data():
    if not os.getenv("DATABASE_URL"):
        pytest.skip("needs a real Postgres (DATABASE_URL)")

    from app.graph.memory import open_durable_backends, prune_checkpoints

    async def run():
        suffix = uuid.uuid4().hex
        old_thread = f"prune-old-{suffix}"
        new_thread = f"prune-new-{suffix}"
        orphan_thread = f"prune-orphan-{suffix}"
        pool, _saver, _store = await open_durable_backends(
            os.environ["DATABASE_URL"],
            agent_run_setup_on_boot=True,
        )
        try:
            async with pool.connection() as conn:
                async with conn.transaction():
                    async with conn.cursor() as cur:
                        await cur.execute(
                            """
                            INSERT INTO checkpoints
                                (thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata)
                            VALUES
                                (%s, %s, %s, %s::jsonb, '{}'::jsonb),
                                (%s, %s, %s, %s::jsonb, '{}'::jsonb)
                            ON CONFLICT DO NOTHING
                            """,
                            (
                                old_thread,
                                "",
                                "old",
                                '{"ts":"2020-01-01T00:00:00+00:00","channel_versions":{"old":"1"}}',
                                new_thread,
                                "",
                                "new",
                                '{"ts":"2999-01-01T00:00:00+00:00","channel_versions":{"new":"2"}}',
                            ),
                        )
                        await cur.execute(
                            """
                            INSERT INTO checkpoint_writes
                                (thread_id, checkpoint_ns, checkpoint_id, task_id, idx,
                                 channel, type, blob)
                            VALUES (%s, '', 'old', 'task', 0, 'old', 'json', %s),
                                   (%s, '', 'new', 'task', 0, 'new', 'json', %s),
                                       (%s, '', 'missing', 'task', 0, 'none', 'json', %s)
                            ON CONFLICT DO NOTHING
                            """,
                            (old_thread, b"old", new_thread, b"new", orphan_thread, b"orphan"),
                        )
                        await cur.execute(
                            """
                            INSERT INTO checkpoint_blobs
                                (thread_id, checkpoint_ns, channel, version, type, blob)
                            VALUES (%s, '', 'old', '1', 'json', %s),
                                   (%s, '', 'new', '2', 'json', %s),
                                   (%s, '', 'none', '1', 'json', %s)
                            ON CONFLICT DO NOTHING
                            """,
                            (old_thread, b"old", new_thread, b"new", orphan_thread, b"orphan"),
                        )

            result = await prune_checkpoints(
                pool,
                30,
                now=datetime(2025, 1, 1, tzinfo=UTC),
            )
            assert result == {
                "checkpoints_deleted": 1,
                "writes_deleted": 2,
                "blobs_deleted": 2,
                "retention_days": 30,
            }

            async with pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "SELECT checkpoint_id FROM checkpoints WHERE thread_id = %s",
                        (new_thread,),
                    )
                    assert await cur.fetchone() == {"checkpoint_id": "new"}
                    await cur.execute(
                        "SELECT COUNT(*) AS count FROM checkpoint_writes "
                        "WHERE thread_id = %s",
                        (new_thread,),
                    )
                    assert (await cur.fetchone())["count"] == 1
                    await cur.execute(
                        "SELECT COUNT(*) AS count FROM checkpoint_blobs "
                        "WHERE thread_id = %s",
                        (new_thread,),
                    )
                    assert (await cur.fetchone())["count"] == 1
        finally:
            async with pool.connection() as conn:
                async with conn.transaction():
                    async with conn.cursor() as cur:
                        await cur.execute(
                            "DELETE FROM checkpoint_writes WHERE thread_id IN (%s, %s, %s)",
                            (old_thread, new_thread, orphan_thread),
                        )
                        await cur.execute(
                            "DELETE FROM checkpoint_blobs WHERE thread_id IN (%s, %s, %s)",
                            (old_thread, new_thread, orphan_thread),
                        )
                        await cur.execute(
                            "DELETE FROM checkpoints WHERE thread_id IN (%s, %s, %s)",
                            (old_thread, new_thread, orphan_thread),
                        )
            await pool.close()

    _run(run())


@pytest.mark.postgres
def test_postgres_pruning_preserves_parent_writes_referenced_by_child():
    if not os.getenv("DATABASE_URL"):
        pytest.skip("needs a real Postgres (DATABASE_URL)")

    from app.graph.memory import open_durable_backends, prune_checkpoints

    async def run():
        suffix = uuid.uuid4().hex
        thread_id = f"prune-parent-child-{suffix}"
        parent_id = f"parent-{suffix}"
        child_id = f"child-{suffix}"
        orphan_id = f"orphan-{suffix}"
        pool, _saver, _store = await open_durable_backends(
            os.environ["DATABASE_URL"],
            agent_run_setup_on_boot=True,
        )
        try:
            async with pool.connection() as conn:
                async with conn.transaction():
                    async with conn.cursor() as cur:
                        await cur.execute(
                            """
                            INSERT INTO checkpoints
                                (thread_id, checkpoint_ns, checkpoint_id,
                                 parent_checkpoint_id, checkpoint, metadata)
                            VALUES
                                (%s, '', %s, NULL, %s::jsonb, '{}'::jsonb),
                                (%s, '', %s, %s, %s::jsonb, '{}'::jsonb)
                            """,
                            (
                                thread_id,
                                parent_id,
                                '{"v":3,"ts":"2020-01-01T00:00:00+00:00",'
                                '"channel_versions":{}}',
                                thread_id,
                                child_id,
                                parent_id,
                                '{"v":3,"ts":"2999-01-01T00:00:00+00:00",'
                                '"channel_versions":{}}',
                            ),
                        )
                        await cur.execute(
                            """
                            INSERT INTO checkpoint_writes
                                (thread_id, checkpoint_ns, checkpoint_id, task_id, idx,
                                 channel, type, blob)
                            VALUES
                                (%s, '', %s, 'parent-task', 0, '__pregel_tasks', 'json', %s),
                                (%s, '', %s, 'child-task', 0, 'channel', 'json', %s),
                                (%s, '', %s, 'orphan-task', 0, 'channel', 'json', %s)
                            """,
                            (
                                thread_id,
                                parent_id,
                                b"parent-write",
                                thread_id,
                                child_id,
                                b"child-write",
                                thread_id,
                                orphan_id,
                                b"orphan-write",
                            ),
                        )

            result = await prune_checkpoints(
                pool,
                30,
                now=datetime(2025, 1, 1, tzinfo=UTC),
            )
            assert result == {
                "checkpoints_deleted": 1,
                "writes_deleted": 1,
                "blobs_deleted": 0,
                "retention_days": 30,
            }

            async with pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        """
                        SELECT checkpoint_id
                        FROM checkpoints
                        WHERE thread_id = %s
                        ORDER BY checkpoint_id
                        """,
                        (thread_id,),
                    )
                    assert await cur.fetchall() == [{"checkpoint_id": child_id}]

                    await cur.execute(
                        """
                        SELECT checkpoint_id, blob
                        FROM checkpoint_writes
                        WHERE thread_id = %s
                        ORDER BY checkpoint_id
                        """,
                        (thread_id,),
                    )
                    assert await cur.fetchall() == [
                        {"checkpoint_id": child_id, "blob": b"child-write"},
                        {"checkpoint_id": parent_id, "blob": b"parent-write"},
                    ]
        finally:
            async with pool.connection() as conn:
                async with conn.transaction():
                    async with conn.cursor() as cur:
                        for table in (
                            "checkpoints",
                            "checkpoint_blobs",
                            "checkpoint_writes",
                        ):
                            await cur.execute(
                                f"DELETE FROM {table} WHERE thread_id = %s",
                                (thread_id,),
                            )
            await pool.close()

    _run(run())


@pytest.mark.postgres
def test_postgres_interrupt_resumes_through_a_new_pool_and_graph():
    if not os.getenv("DATABASE_URL"):
        pytest.skip("needs a real Postgres (DATABASE_URL)")

    from langgraph.graph import END, START, StateGraph
    from langgraph.types import Command, interrupt
    from typing_extensions import TypedDict

    from app.graph.memory import open_durable_backends

    class State(TypedDict, total=False):
        approved: bool

    def review(state: State) -> dict:
        decision = interrupt({"reason": "test"})
        return {"approved": bool(decision.get("approved"))}

    def build(saver):
        builder = StateGraph(State)
        builder.add_node("review", review)
        builder.add_edge(START, "review")
        builder.add_edge("review", END)
        return builder.compile(checkpointer=saver)

    async def run():
        config = {
            "configurable": {
                "thread_id": f"restart-test:apply-copilot:{uuid.uuid4().hex}"
            }
        }
        pool, saver, _store = await open_durable_backends(
            os.environ["DATABASE_URL"],
            agent_run_setup_on_boot=True,
        )
        try:
            first = await build(saver).ainvoke({}, config)
            assert "__interrupt__" in first
        finally:
            await pool.close()

        pool, saver, _store = await open_durable_backends(
            os.environ["DATABASE_URL"],
            agent_run_setup_on_boot=True,
        )
        try:
            resumed = await build(saver).ainvoke(Command(resume={"approved": True}), config)
            assert resumed["approved"] is True
        finally:
            thread_id = config["configurable"]["thread_id"]
            async with pool.connection() as conn:
                async with conn.transaction():
                    async with conn.cursor() as cur:
                        for table in (
                            "checkpoints",
                            "checkpoint_blobs",
                            "checkpoint_writes",
                        ):
                            await cur.execute(
                                f"DELETE FROM {table} WHERE thread_id = %s",
                                (thread_id,),
                            )
            await pool.close()

    _run(run())

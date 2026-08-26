"""Durable LangGraph checkpoint and long-term memory helpers.

The Postgres imports intentionally live inside :func:`open_durable_backends` so
the agent can keep its dependency-light, in-memory local/CI mode. A configured
database has exactly one pool shared by the assistant saver, specialist saver,
and Store for the lifetime of the FastAPI application.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

__all__ = [
    "agent_namespace",
    "open_durable_backends",
    "profile_namespace",
    "prune_checkpoints",
]

_PRUNE_BATCH_SIZE = 1_000


def profile_namespace(user_id: str) -> tuple[str, str, str]:
    """Return the shared profile namespace.

    The four specialist agents may read this namespace for resume, preference,
    and constraint context. Profile writes remain outside the specialist
    graphs, so this helper documents the namespace as read-only to them.
    """

    return ("user", user_id, "profile")


def agent_namespace(user_id: str, agent_id: str) -> tuple[str, str, str]:
    """Return the private long-term-memory namespace for one specialist."""

    return ("user", user_id, agent_id)


async def _close_pool(pool: Any) -> None:
    """Close a pool while preserving the original startup/maintenance error."""

    try:
        await pool.close()
    except BaseException:
        # The operation which caused startup to fail is more useful to callers
        # than a secondary teardown exception. The pool close was still tried.
        pass


async def open_durable_backends(
    database_url: str,
    *,
    agent_run_setup_on_boot: bool = True,
):
    """Open one pgbouncer-safe pool and its saver/Store pair.

    PostgreSQL dependencies are imported lazily here. ``setup()`` is idempotent
    and is controlled only by ``AGENT_RUN_SETUP_ON_BOOT``; when enabled, both
    the checkpoint saver and long-term Store schemas are initialized before the
    tuple is returned. Any error after pool construction closes that pool before
    re-raising, so callers never receive a partially initialized backend.
    """

    # Keep all PostgreSQL imports in this function: importing app.main without a
    # DATABASE_URL must remain possible in the light CI image.
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
    from langgraph.store.postgres.aio import AsyncPostgresStore
    from psycopg.rows import dict_row
    from psycopg_pool import AsyncConnectionPool

    pool = None
    try:
        # ``prepare_threshold=0`` avoids server-side prepared statements through
        # transaction/statement poolers. Autocommit is required by the installed
        # checkpointer migrations, including CREATE INDEX CONCURRENTLY.
        pool = AsyncConnectionPool(
            conninfo=database_url,
            max_size=10,
            open=False,
            kwargs={
                "autocommit": True,
                "prepare_threshold": 0,
                "row_factory": dict_row,
            },
        )
        await pool.open()
        await pool.wait()

        # Restrict checkpoint deserialization to LangGraph's safe built-in types;
        # the permissive serializer would allow arbitrary msgpack modules.
        serde = JsonPlusSerializer(allowed_msgpack_modules=None)
        saver = AsyncPostgresSaver(pool, serde=serde)
        store = AsyncPostgresStore(pool)
        if agent_run_setup_on_boot:
            await saver.setup()
            await store.setup()
        return pool, saver, store
    except BaseException:
        if pool is not None:
            await _close_pool(pool)
        raise


async def _delete_in_batches(
    cursor: Any,
    statement: str,
    params: tuple[Any, ...],
    *,
    batch_size: int = _PRUNE_BATCH_SIZE,
) -> int:
    """Delete bounded batches and count rows from the server-provided rowcount."""

    if batch_size <= 0:
        raise ValueError("batch_size must be positive")

    deleted_total = 0
    while True:
        await cursor.execute(statement, (*params, batch_size))
        deleted = cursor.rowcount
        if deleted is None or deleted < 0:
            raise RuntimeError("database did not provide a DELETE row count")
        deleted_total += deleted
        if deleted < batch_size:
            return deleted_total


async def prune_checkpoints(
    pool: Any,
    retention_days: int,
    *,
    now: datetime | None = None,
) -> dict[str, int]:
    """Delete expired checkpoints and unreferenced checkpoint payload rows.

    The installed ``langgraph-checkpoint-postgres==3.1.0`` schema stores the
    checkpoint timestamp in ``checkpoints.checkpoint->>'ts'``. The three tables
    are locked in ``SHARE ROW EXCLUSIVE`` mode for one transaction: this blocks
    saver writes and serializes concurrent maintenance calls while the expired
    checkpoints and orphan writes/blobs are selected, preventing a current
    checkpoint from losing a payload during the sweep. Store rows are
    intentionally untouched.
    """

    if isinstance(retention_days, bool) or retention_days <= 0:
        raise ValueError("retention_days must be a positive integer")

    if now is None:
        now = datetime.now(UTC)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    else:
        now = now.astimezone(UTC)
    cutoff = now - timedelta(days=retention_days)

    async with pool.connection() as connection:
        async with connection.transaction():
            async with connection.cursor() as cursor:
                # SHARE ROW EXCLUSIVE conflicts with the ROW EXCLUSIVE locks
                # taken by saver INSERT/UPDATE statements and with another
                # maintenance run. All three tables are included because writes
                # can be persisted independently via ``aput_writes``. Keep this
                # order identical to AsyncPostgresSaver.adelete_thread
                # (checkpoints, blobs, writes), so concurrent maintenance and
                # thread deletion cannot form a lock-order cycle.
                await cursor.execute(
                    "LOCK TABLE checkpoints, checkpoint_blobs, checkpoint_writes "
                    "IN SHARE ROW EXCLUSIVE MODE"
                )
                checkpoints_deleted = await _delete_in_batches(
                    cursor,
                    """
                    DELETE FROM checkpoints AS checkpoints
                    WHERE checkpoints.ctid IN (
                        SELECT candidate.ctid
                        FROM checkpoints AS candidate
                        WHERE (candidate.checkpoint->>'ts')::timestamptz < %s
                        ORDER BY candidate.thread_id, candidate.checkpoint_ns,
                                 candidate.checkpoint_id
                        LIMIT %s
                    )
                    """,
                    (cutoff,),
                )
                writes_deleted = await _delete_in_batches(
                    cursor,
                    """
                    DELETE FROM checkpoint_writes AS writes
                    WHERE writes.ctid IN (
                        SELECT candidate.ctid
                        FROM checkpoint_writes AS candidate
                        -- Legacy LangGraph checkpoints can load pending sends
                        -- from a surviving child's parent checkpoint.
                        WHERE NOT EXISTS (
                            SELECT 1
                            FROM checkpoints AS checkpoints
                            WHERE checkpoints.thread_id = candidate.thread_id
                              AND checkpoints.checkpoint_ns = candidate.checkpoint_ns
                              AND (
                                  checkpoints.checkpoint_id = candidate.checkpoint_id
                                  OR checkpoints.parent_checkpoint_id = candidate.checkpoint_id
                              )
                        )
                        ORDER BY candidate.thread_id, candidate.checkpoint_ns,
                                 candidate.checkpoint_id, candidate.task_id,
                                 candidate.idx
                        LIMIT %s
                    )
                    """,
                    (),
                )
                blobs_deleted = await _delete_in_batches(
                    cursor,
                    """
                    DELETE FROM checkpoint_blobs AS blobs
                    WHERE blobs.ctid IN (
                        SELECT candidate.ctid
                        FROM checkpoint_blobs AS candidate
                        WHERE NOT EXISTS (
                            SELECT 1
                            FROM checkpoints AS checkpoints
                            WHERE checkpoints.thread_id = candidate.thread_id
                              AND checkpoints.checkpoint_ns = candidate.checkpoint_ns
                              AND checkpoints.checkpoint->'channel_versions'->>
                                  candidate.channel = candidate.version
                        )
                        ORDER BY candidate.thread_id, candidate.checkpoint_ns,
                                 candidate.channel, candidate.version
                        LIMIT %s
                    )
                    """,
                    (),
                )

    return {
        "checkpoints_deleted": int(checkpoints_deleted),
        "writes_deleted": int(writes_deleted),
        "blobs_deleted": int(blobs_deleted),
        "retention_days": int(retention_days),
    }

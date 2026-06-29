import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import type { Pool } from 'pg';
import { applyMigration, bootstrapIfNeeded } from './db-migrations';

// Pool whose query() routes through a single handler.
// Only use when pool.connect() is never called by the function under test.
function poolQueryOnly(
  handler: (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] },
): Pool {
  return {
    query: async (sql: string, params?: unknown[]) => handler(sql, params),
    connect: async () => {
      throw new Error('pool.connect() was called unexpectedly');
    },
  } as unknown as Pool;
}

// Pool with separate handlers for pool.query (used for the "already recorded?" check)
// and for each client.query call (BEGIN / SQL / INSERT / COMMIT).
function poolWithClient(
  poolHandler: (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] },
  clientHandler: (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] },
): Pool {
  return {
    query: async (sql: string, params?: unknown[]) => poolHandler(sql, params),
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => clientHandler(sql, params),
      release: () => {},
    }),
  } as unknown as Pool;
}

// ─── applyMigration ───────────────────────────────────────────────────────────

test('applyMigration returns false when migration is already recorded', async () => {
  const pool = poolQueryOnly((sql) => {
    if (sql.includes('WHERE filename')) return { rows: [{ '?column?': 1 }] };
    return { rows: [] };
  });
  const dir = await mkdtemp(join(tmpdir(), 'jobops-'));
  const filePath = join(dir, '001_test.sql');
  await writeFile(filePath, 'SELECT 1;');
  try {
    const result = await applyMigration(pool, filePath);
    assert.equal(result, false);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('applyMigration runs BEGIN/SQL/INSERT/COMMIT and returns true on success', async () => {
  const executed: string[] = [];
  const pool = poolWithClient(
    // pool.query: the SELECT check returns empty (not yet recorded)
    (sql) => {
      if (sql.includes('WHERE filename')) return { rows: [] };
      return { rows: [] };
    },
    // client.query: record each call; return rowCount:1 for INSERT so the
    // ON CONFLICT rowCount check sees a successful insert (not a conflict).
    (sql) => {
      executed.push(sql.trim().slice(0, 80));
      if (sql.includes('INSERT INTO schema_migrations')) return { rows: [], rowCount: 1 };
      return { rows: [] };
    },
  );
  const dir = await mkdtemp(join(tmpdir(), 'jobops-'));
  const filePath = join(dir, '001_test.sql');
  await writeFile(filePath, 'CREATE TABLE _test_ok (id serial);');
  try {
    const result = await applyMigration(pool, filePath);
    assert.equal(result, true);
    assert.ok(executed.includes('BEGIN'), `expected BEGIN; got: ${JSON.stringify(executed)}`);
    assert.ok(
      executed.some((q) => q.startsWith('INSERT INTO schema_migrations')),
      `expected INSERT schema_migrations; got: ${JSON.stringify(executed)}`,
    );
    assert.ok(executed.includes('COMMIT'), `expected COMMIT; got: ${JSON.stringify(executed)}`);
    assert.ok(!executed.includes('ROLLBACK'), 'should not have rolled back on success');
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('applyMigration rolls back and rethrows when the migration SQL fails', async () => {
  const executed: string[] = [];
  let clientCallCount = 0;
  const pool = poolWithClient(
    (sql) => {
      if (sql.includes('WHERE filename')) return { rows: [] };
      return { rows: [] };
    },
    async (sql) => {
      clientCallCount++;
      executed.push(sql.trim().slice(0, 80));
      // 1st call = BEGIN (ok), 2nd call = the migration SQL (fail), 3rd call = ROLLBACK
      if (clientCallCount === 2) throw new Error('syntax error at or near BAD');
      return { rows: [] };
    },
  );
  const dir = await mkdtemp(join(tmpdir(), 'jobops-'));
  const filePath = join(dir, '001_bad.sql');
  await writeFile(filePath, 'BAD SQL THAT FAILS;');
  try {
    await assert.rejects(() => applyMigration(pool, filePath), /syntax error/);
    assert.ok(executed.includes('ROLLBACK'), `expected ROLLBACK; got: ${JSON.stringify(executed)}`);
    assert.ok(!executed.includes('COMMIT'), 'should not have committed after failure');
    assert.ok(
      !executed.some((q) => q.startsWith('INSERT INTO schema_migrations')),
      'should not have recorded the migration after failure',
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('applyMigration returns false and rolls back when a concurrent process wins the INSERT race (rowCount 0)', async () => {
  const executed: string[] = [];
  const pool = poolWithClient(
    (sql) => {
      if (sql.includes('WHERE filename')) return { rows: [] }; // not yet recorded by upfront SELECT
      return { rows: [] };
    },
    (sql) => {
      executed.push(sql.trim().slice(0, 80));
      if (sql.includes('INSERT INTO schema_migrations')) {
        return { rows: [], rowCount: 0 }; // simulate concurrent process already inserted
      }
      return { rows: [], rowCount: 0 };
    },
  );
  const dir = await mkdtemp(join(tmpdir(), 'jobops-'));
  const filePath = join(dir, '001_concurrent.sql');
  await writeFile(filePath, 'SELECT 1;');
  try {
    const result = await applyMigration(pool, filePath);
    assert.equal(result, false, 'should return false when concurrent process wins INSERT race');
    assert.ok(executed.includes('ROLLBACK'), `expected ROLLBACK; got: ${JSON.stringify(executed)}`);
    assert.ok(!executed.includes('COMMIT'), 'should not have committed');
  } finally {
    await rm(dir, { recursive: true });
  }
});

// ─── bootstrapIfNeeded ────────────────────────────────────────────────────────

test('bootstrapIfNeeded pre-seeds all migrations when both sentinel tables exist', async () => {
  const inserted: string[] = [];
  const pool = poolQueryOnly((sql, params) => {
    if (sql.includes('count(*)')) return { rows: [{ n: '0' }] };
    // Return both sentinel tables so the full-initialisation check passes.
    if (sql.includes('information_schema')) {
      return { rows: [{ table_name: 'jobs' }, { table_name: 'agent_outputs' }] };
    }
    if (sql.includes('INSERT INTO schema_migrations')) inserted.push(String(params?.[0] ?? ''));
    return { rows: [] };
  });
  await bootstrapIfNeeded(pool, ['/m/001_init.sql', '/m/002_jobs.sql']);
  assert.deepEqual(inserted, ['001_init.sql', '002_jobs.sql']);
});

test('bootstrapIfNeeded does nothing when the tracking table already has rows', async () => {
  let extraCalls = 0;
  const pool = poolQueryOnly((sql) => {
    if (sql.includes('count(*)')) return { rows: [{ n: '7' }] };
    extraCalls++;
    return { rows: [] };
  });
  await bootstrapIfNeeded(pool, ['/m/001.sql']);
  assert.equal(extraCalls, 0, 'should not have made further queries after seeing n > 0');
});

test('bootstrapIfNeeded does nothing on a fresh DB (no sentinel tables)', async () => {
  const inserted: string[] = [];
  const pool = poolQueryOnly((sql, params) => {
    if (sql.includes('count(*)')) return { rows: [{ n: '0' }] };
    if (sql.includes('information_schema')) return { rows: [] }; // no tables
    if (sql.includes('INSERT INTO schema_migrations')) inserted.push(String(params?.[0] ?? ''));
    return { rows: [] };
  });
  await bootstrapIfNeeded(pool, ['/m/001.sql']);
  assert.equal(inserted.length, 0, 'should not pre-seed on a fresh DB');
});

test('bootstrapIfNeeded does not pre-seed when jobs exists but agent_outputs is absent (partial migration state)', async () => {
  const inserted: string[] = [];
  const pool = poolQueryOnly((sql, params) => {
    if (sql.includes('count(*)')) return { rows: [{ n: '0' }] };
    // Only jobs returned — agent_outputs missing, indicating a partial earlier run.
    if (sql.includes('information_schema')) return { rows: [{ table_name: 'jobs' }] };
    if (sql.includes('INSERT INTO schema_migrations')) inserted.push(String(params?.[0] ?? ''));
    return { rows: [] };
  });
  await bootstrapIfNeeded(pool, ['/m/001.sql', '/m/008.sql']);
  assert.equal(inserted.length, 0, 'should not pre-seed when schema is only partially initialised');
});

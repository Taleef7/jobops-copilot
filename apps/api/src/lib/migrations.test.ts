import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import type { Pool } from 'pg';
import {
  applyMigration,
  bootstrapIfNeeded,
  findMigrationDir,
  pendingMigrations,
  runMigrations,
} from './migrations';

type MockResult = { rows: Record<string, unknown>[]; rowCount?: number };
type MockHandler = (sql: string, params?: unknown[]) => MockResult | Promise<MockResult>;

// Pool whose query() routes through a single handler.
// Only use when pool.connect() is never called by the function under test.
function poolQueryOnly(handler: MockHandler): Pool {
  return {
    query: async (sql: string, params?: unknown[]) => handler(sql, params),
    connect: async () => {
      throw new Error('pool.connect() was called unexpectedly');
    },
  } as unknown as Pool;
}

// Pool with separate handlers for pool.query (used for the "already recorded?" check)
// and for each client.query call (BEGIN / SQL / INSERT / COMMIT).
function poolWithClient(poolHandler: MockHandler, clientHandler: MockHandler): Pool {
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

test('bootstrapIfNeeded pre-seeds only migrations up to the sentinel when both sentinel tables exist', async () => {
  const inserted: string[] = [];
  const pool = poolQueryOnly((sql, params) => {
    if (sql.includes('count(*)')) return { rows: [{ n: '0' }] };
    if (sql.includes('information_schema')) {
      return { rows: [{ table_name: 'jobs' }, { table_name: 'agent_outputs' }] };
    }
    if (sql.includes('INSERT INTO schema_migrations')) inserted.push(String(params?.[0] ?? ''));
    return { rows: [] };
  });
  // 009 should NOT be pre-seeded; applyMigration will handle it instead.
  await bootstrapIfNeeded(pool, [
    '/m/001_init.sql',
    '/m/008_agent_outputs.sql',
    '/m/009_drop_display_name.sql',
  ]);
  assert.deepEqual(inserted, ['001_init.sql', '008_agent_outputs.sql']);
  assert.ok(!inserted.includes('009_drop_display_name.sql'), '009 must not be pre-seeded');
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

// ─── findMigrationDir ─────────────────────────────────────────────────────────

test('findMigrationDir walks up to db/migrations from a nested build directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jobops-'));
  try {
    // Mirrors the deploy package: .deploy/db/migrations next to .deploy/dist/lib.
    await mkdir(join(root, 'db', 'migrations'), { recursive: true });
    await writeFile(join(root, 'db', 'migrations', '001_core.sql'), 'SELECT 1;');
    await mkdir(join(root, 'dist', 'lib'), { recursive: true });

    assert.equal(findMigrationDir(join(root, 'dist', 'lib')), join(root, 'db', 'migrations'));
  } finally {
    await rm(root, { recursive: true });
  }
});

test('findMigrationDir ignores a db/migrations directory that holds no .sql files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jobops-'));
  try {
    // A same-named but empty directory must not shadow the real one further up.
    await mkdir(join(root, 'db', 'migrations'), { recursive: true });
    await writeFile(join(root, 'db', 'migrations', '001_core.sql'), 'SELECT 1;');
    await mkdir(join(root, 'pkg', 'db', 'migrations'), { recursive: true });

    assert.equal(findMigrationDir(join(root, 'pkg')), join(root, 'db', 'migrations'));
  } finally {
    await rm(root, { recursive: true });
  }
});

test('findMigrationDir returns null when nothing above holds migrations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jobops-'));
  try {
    assert.equal(findMigrationDir(root), null);
  } finally {
    await rm(root, { recursive: true });
  }
});

// ─── pendingMigrations ────────────────────────────────────────────────────────

test('pendingMigrations reports files on disk that schema_migrations never recorded', async () => {
  // Exactly the production state that went unnoticed: the tracker stuck at 002
  // while the schema had advanced, so everything after it was silently pending.
  const pool = poolQueryOnly(() => ({
    rows: [{ filename: '001_core_tables.sql' }, { filename: '002_outreach_gmail_draft_id.sql' }],
  }));

  const pending = await pendingMigrations(pool, [
    '/db/migrations/001_core_tables.sql',
    '/db/migrations/002_outreach_gmail_draft_id.sql',
    '/db/migrations/003_vector_store.sql',
    '/db/migrations/008_agent_outputs.sql',
  ]);

  assert.deepEqual(pending, ['003_vector_store.sql', '008_agent_outputs.sql']);
});

test('pendingMigrations is empty when every shipped migration is recorded', async () => {
  const pool = poolQueryOnly(() => ({ rows: [{ filename: '001_core_tables.sql' }] }));
  const pending = await pendingMigrations(pool, ['/db/migrations/001_core_tables.sql']);
  assert.deepEqual(pending, []);
});

// ─── runMigrations ────────────────────────────────────────────────────────────

/** Pool that records every statement, on the pool and on checked-out clients. */
function recordingPool(alreadyApplied: Set<string>) {
  const statements: string[] = [];
  const respond = (sql: string, params?: unknown[]) => {
    statements.push(sql.trim().split('\n')[0]!.trim());
    if (sql.includes('WHERE filename')) {
      return { rows: alreadyApplied.has(String(params?.[0] ?? '')) ? [{ ok: 1 }] : [], rowCount: 0 };
    }
    if (sql.includes('count(*)')) return { rows: [{ n: '1' }], rowCount: 1 };
    if (sql.includes('INSERT INTO schema_migrations')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };

  const pool = {
    query: async (sql: string, params?: unknown[]) => respond(sql, params),
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => respond(sql, params),
      release: () => {},
    }),
  } as unknown as Pool;

  return { pool, statements };
}

test('runMigrations takes the advisory lock, applies pending files, and releases it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobops-'));
  try {
    await writeFile(join(dir, '001_first.sql'), 'SELECT 1;');
    await writeFile(join(dir, '002_second.sql'), 'SELECT 2;');

    const { pool, statements } = recordingPool(new Set(['001_first.sql']));
    const result = await runMigrations(pool, dir);

    assert.deepEqual(result, { applied: 1, skipped: 1 }, '001 already recorded, 002 applied');

    const lockAt = statements.findIndex((s) => s.includes('pg_advisory_lock'));
    const unlockAt = statements.findIndex((s) => s.includes('pg_advisory_unlock'));
    const insertAt = statements.findIndex((s) => s.includes('INSERT INTO schema_migrations'));

    assert.ok(lockAt >= 0, 'should acquire the advisory lock');
    assert.ok(unlockAt >= 0, 'should release the advisory lock');
    assert.ok(
      statements.some((s) => s.includes('lock_timeout')),
      'should bound the wait so a wedged peer fails the boot instead of hanging it',
    );
    assert.ok(lockAt < insertAt, 'lock must be held before any migration is written');
    assert.ok(insertAt < unlockAt, 'lock must be held until the last migration is written');
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('runMigrations releases the advisory lock when a migration throws', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobops-'));
  try {
    await writeFile(join(dir, '001_boom.sql'), 'SELECT 1;');

    const statements: string[] = [];
    const pool = {
      query: async (sql: string) => {
        statements.push(sql.trim().split('\n')[0]!.trim());
        if (sql.includes('count(*)')) return { rows: [{ n: '1' }] };
        return { rows: [] };
      },
      connect: async () => ({
        query: async (sql: string) => {
          statements.push(sql.trim().split('\n')[0]!.trim());
          if (sql.includes('SELECT 1;')) throw new Error('syntax error at or near');
          return { rows: [], rowCount: 1 };
        },
        release: () => {},
      }),
    } as unknown as Pool;

    await assert.rejects(() => runMigrations(pool, dir), /syntax error/);
    assert.ok(
      statements.some((s) => s.includes('pg_advisory_unlock')),
      'a failed migration must not strand the lock and block every future boot',
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { closePool, getPool } from './postgres';

test('getPool registers exactly one error listener across repeated calls', async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
  try {
    const first = getPool();
    const second = getPool();
    getPool();

    assert.ok(first, 'expected a pool when DATABASE_URL is set');
    assert.equal(first, second, 'getPool should return the same singleton');
    // The bug: an error listener was added on every getPool() call (unbounded leak).
    assert.equal(first!.listenerCount('error'), 1);
  } finally {
    await closePool();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

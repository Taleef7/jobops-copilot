import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { PostgresTtlCache } from './cache.postgres';

// Resilience unit tests — no real DB. A cache is optional, so a DB failure must degrade
// to a direct compute, never turn a cache outage into a job-search outage (#211 review).

function rejectingPool(): Pool {
  return { query: async () => Promise.reject(new Error('db down')) } as unknown as Pool;
}

test('a failed cache READ degrades to a direct compute (does not throw)', async () => {
  const cache = new PostgresTtlCache<number[]>(rejectingPool(), { ttlMs: 60_000, namespace: 'x' });
  let calls = 0;
  const value = await cache.getOrCompute('k', async () => {
    calls += 1;
    return [calls];
  });
  assert.deepEqual(value, [1]);
  assert.equal(calls, 1);
});

test('a failed cache WRITE still returns the computed value', async () => {
  // Read resolves empty (miss), write rejects — the value must still come back.
  let call = 0;
  const pool = {
    query: async () => {
      call += 1;
      if (call === 1) return { rows: [] }; // the SELECT: a miss
      throw new Error('write failed'); // the INSERT
    },
  } as unknown as Pool;
  const cache = new PostgresTtlCache<number[]>(pool, { ttlMs: 60_000, namespace: 'x' });
  const value = await cache.getOrCompute('k', async () => [7]);
  assert.deepEqual(value, [7]);
});

test('ttlMs <= 0 computes directly without touching the DB', async () => {
  const cache = new PostgresTtlCache<number[]>(rejectingPool(), { ttlMs: 0, namespace: 'x' });
  assert.deepEqual(await cache.getOrCompute('k', async () => [9]), [9]);
});

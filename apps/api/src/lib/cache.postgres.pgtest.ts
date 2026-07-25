import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { getPool } from './postgres';
import { PostgresTtlCache } from './cache.postgres';

// Real-Postgres only (see rate-limit-store.pgtest.ts). Proves the shared cache backing
// matches the in-memory TtlCache semantics (serve-on-hit, TTL, never cache a failure).
const DB = process.env.DATABASE_URL?.trim();

test(
  'PostgresTtlCache: serves hits, honors TTL, and never caches a failed compute',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async (t) => {
    const pool = getPool();
    assert.ok(pool, 'expected a live pool');
    const ns = `t-${randomUUID().slice(0, 8)}`;

    await t.test('caches a computed value and serves it without recomputing', async () => {
      const cache = new PostgresTtlCache<number[]>(pool, { ttlMs: 60_000, namespace: ns });
      let calls = 0;
      const compute = async () => {
        calls += 1;
        return [calls];
      };
      assert.deepEqual(await cache.getOrCompute('k', compute), [1]);
      assert.deepEqual(await cache.getOrCompute('k', compute), [1]); // from cache
      assert.equal(calls, 1);
      await cache.clear();
    });

    await t.test('ttlMs <= 0 disables caching (always recompute)', async () => {
      const cache = new PostgresTtlCache<number[]>(pool, { ttlMs: 0, namespace: ns });
      let calls = 0;
      const compute = async () => {
        calls += 1;
        return [calls];
      };
      await cache.getOrCompute('k', compute);
      await cache.getOrCompute('k', compute);
      assert.equal(calls, 2);
    });

    await t.test('a failed compute is not cached — the next call retries', async () => {
      const cache = new PostgresTtlCache<number[]>(pool, { ttlMs: 60_000, namespace: ns });
      await assert.rejects(
        cache.getOrCompute('boom', async () => {
          throw new Error('nope');
        }),
      );
      assert.deepEqual(await cache.getOrCompute('boom', async () => [42]), [42]);
      await cache.clear();
    });

    await t.test('expired entries are not served', async () => {
      const cache = new PostgresTtlCache<number[]>(pool, { ttlMs: 1, namespace: ns }); // 1ms
      let calls = 0;
      const compute = async () => {
        calls += 1;
        return [calls];
      };
      await cache.getOrCompute('exp', compute);
      await new Promise((resolve) => setTimeout(resolve, 25));
      await cache.getOrCompute('exp', compute);
      assert.equal(calls, 2);
      await cache.clear();
    });
  },
);

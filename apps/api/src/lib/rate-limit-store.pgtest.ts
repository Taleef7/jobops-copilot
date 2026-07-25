import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Options } from 'express-rate-limit';
import { getPool } from './postgres';
import { PostgresRateLimitStore } from './rate-limit-store.postgres';

// Real-Postgres only (named *.pgtest.ts so `npm test` skips it; run via `npm run test:pg`).
// Proves the shared cross-instance counter — the whole point of externalizing the limiter.
const DB = process.env.DATABASE_URL?.trim();

test(
  'PostgresRateLimitStore: shared window counter, expiry reset, and prefix isolation',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async (t) => {
    const pool = getPool();
    assert.ok(pool, 'expected a live pool');

    const store = new PostgresRateLimitStore(pool);
    store.prefix = `t:${randomUUID().slice(0, 8)}:`;
    store.init({ windowMs: 60_000 } as Options);

    await t.test('increments accumulate within the window', async () => {
      const first = await store.increment('user-A');
      const second = await store.increment('user-A');
      assert.equal(first.totalHits, 1);
      assert.equal(second.totalHits, 2);
      assert.ok(second.resetTime instanceof Date);
    });

    await t.test('get reflects the live counter, decrement/resetKey adjust it', async () => {
      assert.equal((await store.get('user-A'))?.totalHits, 2);
      await store.decrement('user-A');
      assert.equal((await store.get('user-A'))?.totalHits, 1);
      await store.resetKey('user-A');
      assert.equal(await store.get('user-A'), undefined);
    });

    await t.test('an elapsed window resets to a fresh 1 on the next hit', async () => {
      const expired = new PostgresRateLimitStore(pool);
      expired.prefix = store.prefix;
      expired.init({ windowMs: 0 } as Options); // each hit's window has already ended
      assert.equal((await expired.increment('user-B')).totalHits, 1);
      assert.equal((await expired.increment('user-B')).totalHits, 1);
    });

    await t.test('a different prefix is a different counter (limiters share one table)', async () => {
      const other = new PostgresRateLimitStore(pool);
      other.prefix = `t:other:${randomUUID().slice(0, 8)}:`;
      other.init({ windowMs: 60_000 } as Options);
      await store.increment('shared');
      assert.equal(await other.get('shared'), undefined);
    });

    await store.resetAll();
  },
);

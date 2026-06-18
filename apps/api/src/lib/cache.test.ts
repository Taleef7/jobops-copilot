import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TtlCache } from './cache';

/** A controllable clock so TTL behavior is deterministic (no real timers). */
function fakeClock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

test('get returns a set value before it expires', () => {
  const clock = fakeClock();
  const cache = new TtlCache<number>({ ttlMs: 1000, now: clock.now });
  cache.set('a', 42);
  assert.equal(cache.get('a'), 42);
  clock.advance(999);
  assert.equal(cache.get('a'), 42);
});

test('get returns undefined once the entry has expired', () => {
  const clock = fakeClock();
  const cache = new TtlCache<number>({ ttlMs: 1000, now: clock.now });
  cache.set('a', 42);
  clock.advance(1000);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.size, 0); // expired entry is evicted on read
});

test('getOrCompute computes once, then serves the cached value', async () => {
  const cache = new TtlCache<string>({ ttlMs: 1000 });
  let calls = 0;
  const compute = async () => {
    calls += 1;
    return `v${calls}`;
  };
  assert.equal(await cache.getOrCompute('k', compute), 'v1');
  assert.equal(await cache.getOrCompute('k', compute), 'v1');
  assert.equal(calls, 1);
});

test('getOrCompute recomputes after the TTL elapses', async () => {
  const clock = fakeClock();
  const cache = new TtlCache<string>({ ttlMs: 1000, now: clock.now });
  let calls = 0;
  const compute = async () => `v${(calls += 1)}`;
  assert.equal(await cache.getOrCompute('k', compute), 'v1');
  clock.advance(1001);
  assert.equal(await cache.getOrCompute('k', compute), 'v2');
  assert.equal(calls, 2);
});

test('ttlMs <= 0 disables caching entirely', async () => {
  const cache = new TtlCache<number>({ ttlMs: 0 });
  cache.set('a', 1);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.size, 0);
  let calls = 0;
  await cache.getOrCompute('k', async () => (calls += 1));
  await cache.getOrCompute('k', async () => (calls += 1));
  assert.equal(calls, 2); // always computes
});

test('a failed compute is not cached (next call retries)', async () => {
  const cache = new TtlCache<string>({ ttlMs: 1000 });
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new Error('boom');
    return 'ok';
  };
  await assert.rejects(() => cache.getOrCompute('k', flaky), /boom/);
  assert.equal(await cache.getOrCompute('k', flaky), 'ok');
  assert.equal(calls, 2);
});

test('evicts the oldest entry past maxEntries', () => {
  const cache = new TtlCache<number>({ ttlMs: 1000, maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3); // evicts 'a'
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
  assert.equal(cache.size, 2);
});

test('re-setting a key refreshes its eviction position (FIFO by last write)', () => {
  const cache = new TtlCache<number>({ ttlMs: 1000, maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('a', 11); // 'a' is now the most-recently written, 'b' the oldest
  cache.set('c', 3); // evicts 'b', not 'a'
  assert.equal(cache.get('a'), 11);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('c'), 3);
});

test('clear empties the cache', () => {
  const cache = new TtlCache<number>({ ttlMs: 1000 });
  cache.set('a', 1);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.get('a'), undefined);
});

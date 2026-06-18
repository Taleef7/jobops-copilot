import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TtlCache } from '../cache';
import { jobSearchCacheKey, withCachedSearch } from './index';
import type { SourcedJob } from './normalize';
import type { JobSource } from './types';

function fakeClock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

function countingSource(name = 'fake'): JobSource & { calls: number } {
  let calls = 0;
  return {
    name,
    async search(query): Promise<SourcedJob[]> {
      calls += 1;
      return [{ title: `${query}-${calls}` } as SourcedJob];
    },
    get calls() {
      return calls;
    },
  } as JobSource & { calls: number };
}

test('identical searches within the TTL hit the source once', async () => {
  const source = countingSource();
  const cache = new TtlCache<SourcedJob[]>({ ttlMs: 1000 });
  const cached = withCachedSearch(source, cache, () => 'us');

  const a = await cached.search('python', {});
  const b = await cached.search('python', {});
  assert.equal(source.calls, 1);
  assert.deepEqual(a, b); // same cached array
});

test('different queries / options are cached separately', async () => {
  const source = countingSource();
  const cache = new TtlCache<SourcedJob[]>({ ttlMs: 1000 });
  const cached = withCachedSearch(source, cache, () => 'us');

  await cached.search('python', {});
  await cached.search('rust', {});
  await cached.search('python', { remoteOnly: true });
  assert.equal(source.calls, 3);
});

test('cache expires after the TTL, re-hitting the source', async () => {
  const source = countingSource();
  const clock = fakeClock();
  const cache = new TtlCache<SourcedJob[]>({ ttlMs: 1000, now: clock.now });
  const cached = withCachedSearch(source, cache, () => 'us');

  await cached.search('python', {});
  clock.advance(1001);
  await cached.search('python', {});
  assert.equal(source.calls, 2);
});

test('TTL=0 disables caching (every search hits the source)', async () => {
  const source = countingSource();
  const cache = new TtlCache<SourcedJob[]>({ ttlMs: 0 });
  const cached = withCachedSearch(source, cache, () => 'us');

  await cached.search('python', {});
  await cached.search('python', {});
  assert.equal(source.calls, 2);
});

test('a failing search is not cached (next call retries)', async () => {
  let calls = 0;
  const flaky: JobSource = {
    name: 'flaky',
    async search() {
      calls += 1;
      if (calls === 1) throw new Error('429');
      return [];
    },
  };
  const cache = new TtlCache<SourcedJob[]>({ ttlMs: 1000 });
  const cached = withCachedSearch(flaky, cache, () => 'us');

  await assert.rejects(() => cached.search('python', {}), /429/);
  await cached.search('python', {});
  assert.equal(calls, 2);
});

test('the same query in a different country is a distinct key', () => {
  const us = jobSearchCacheKey('python', {}, 'us');
  const gb = jobSearchCacheKey('python', {}, 'gb');
  assert.notEqual(us, gb);
  // case/whitespace-insensitive on the query itself
  assert.equal(jobSearchCacheKey('  Python ', {}, 'us'), jobSearchCacheKey('python', {}, 'us'));
});

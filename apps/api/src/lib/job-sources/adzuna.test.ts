import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdzunaSource } from './adzuna';

function captureFetch() {
  const original = globalThis.fetch;
  let lastUrl = '';
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    lastUrl = String(input);
    return { ok: true, status: 200, json: async () => ({ results: [] }) } as unknown as Response;
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
    url: () => new URL(lastUrl),
  };
}

async function withAdzunaKeys(fn: () => Promise<void>) {
  const prevId = process.env.ADZUNA_APP_ID;
  const prevKey = process.env.ADZUNA_APP_KEY;
  process.env.ADZUNA_APP_ID = 'id';
  process.env.ADZUNA_APP_KEY = 'key';
  try {
    await fn();
  } finally {
    if (prevId === undefined) delete process.env.ADZUNA_APP_ID;
    else process.env.ADZUNA_APP_ID = prevId;
    if (prevKey === undefined) delete process.env.ADZUNA_APP_KEY;
    else process.env.ADZUNA_APP_KEY = prevKey;
  }
}

test('Adzuna omits the geographic `where` for non-place locations and stays fresh', async () => {
  const capture = captureFetch();
  await withAdzunaKeys(async () => {
    try {
      await createAdzunaSource().search('python', { location: 'Remote' });
      const url = capture.url();
      assert.equal(url.searchParams.get('where'), null);
      assert.equal(url.searchParams.get('what'), 'python');
      assert.equal(url.searchParams.get('sort_by'), 'relevance');
      assert.equal(url.searchParams.get('max_days_old'), '30');
    } finally {
      capture.restore();
    }
  });
});

test('Adzuna sends `where` for a real location and biases remote-only queries', async () => {
  const capture = captureFetch();
  await withAdzunaKeys(async () => {
    try {
      await createAdzunaSource().search('python', { location: 'Boston', remoteOnly: true });
      const url = capture.url();
      assert.equal(url.searchParams.get('where'), 'Boston');
      assert.equal(url.searchParams.get('what'), 'python remote');
    } finally {
      capture.restore();
    }
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { getJobSource } from './index';

type StubResult = { ok: boolean; status?: number; body: unknown };

function stubFetch(handler: (url: string) => StubResult): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const result = handler(String(input));
    return {
      ok: result.ok,
      status: result.status ?? (result.ok ? 200 : 500),
      json: async () => result.body,
    } as unknown as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('getJobSource uses Remotive when Adzuna is not configured', async () => {
  await withEnv({ ADZUNA_APP_ID: undefined, ADZUNA_APP_KEY: undefined }, async () => {
    const restore = stubFetch(() => ({ ok: true, body: { jobs: [{ url: 'https://r/1', title: 'T', company_name: 'C' }] } }));
    try {
      const source = getJobSource();
      assert.equal(source.name, 'remotive');
      const jobs = await source.search('engineer');
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]?.source, 'remotive');
    } finally {
      restore();
    }
  });
});

test('getJobSource prefers Adzuna when configured', async () => {
  await withEnv({ ADZUNA_APP_ID: 'id', ADZUNA_APP_KEY: 'key' }, async () => {
    const restore = stubFetch((url) =>
      url.includes('adzuna')
        ? { ok: true, body: { results: [{ redirect_url: 'https://a/1', title: 'AI', company: { display_name: 'Acme' } }] } }
        : { ok: true, body: { jobs: [] } },
    );
    try {
      const source = getJobSource();
      const jobs = await source.search('ai');
      assert.equal(source.name, 'adzuna');
      assert.equal(jobs[0]?.source, 'adzuna');
    } finally {
      restore();
    }
  });
});

test('getJobSource falls back to Remotive when Adzuna fails', async () => {
  await withEnv({ ADZUNA_APP_ID: 'id', ADZUNA_APP_KEY: 'key' }, async () => {
    const restore = stubFetch((url) =>
      url.includes('adzuna')
        ? { ok: false, status: 429, body: {} }
        : { ok: true, body: { jobs: [{ url: 'https://r/2', title: 'T', company_name: 'C' }] } },
    );
    try {
      const source = getJobSource();
      const jobs = await source.search('ai');
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]?.source, 'remotive');
      assert.equal(source.name, 'remotive');
    } finally {
      restore();
    }
  });
});

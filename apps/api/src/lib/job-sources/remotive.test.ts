import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemotiveSource } from './remotive';

function stubFetch(jobs: unknown[]): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({ ok: true, status: 200, json: async () => ({ jobs }) }) as unknown as Response) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function stubFetchWithUrl(jobs: unknown[]): { restore: () => void; getUrls: () => string[] } {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    urls.push(String(input));
    return { ok: true, status: 200, json: async () => ({ jobs }) } as unknown as Response;
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
    getUrls: () => urls,
  };
}

test('Remotive filters the generic feed by query terms', async () => {
  const restore = stubFetch([
    { url: 'https://r/1', title: 'Python Developer', company_name: 'Acme', candidate_required_location: 'USA' },
    { url: 'https://r/2', title: 'Marketing Manager', company_name: 'Globex', candidate_required_location: 'USA' },
  ]);
  try {
    const jobs = await createRemotiveSource().search('python');
    assert.deepEqual(
      jobs.map((job) => job.title),
      ['Python Developer'],
    );
  } finally {
    restore();
  }
});

test('Remotive filters by a real location but ignores remote-ish ones', async () => {
  const feed = [
    { url: 'https://r/1', title: 'Engineer', company_name: 'Acme', candidate_required_location: 'USA' },
    { url: 'https://r/2', title: 'Engineer', company_name: 'Globex', candidate_required_location: 'Europe' },
  ];

  let restore = stubFetch(feed);
  try {
    const usOnly = await createRemotiveSource().search('engineer', { location: 'USA' });
    assert.deepEqual(
      usOnly.map((job) => job.location),
      ['USA'],
    );
  } finally {
    restore();
  }

  restore = stubFetch(feed);
  try {
    const all = await createRemotiveSource().search('engineer', { location: 'Remote' });
    assert.equal(all.length, 2);
  } finally {
    restore();
  }
});

test('the request URL carries limit=200 even when opts.limit is 10 and returned array is sliced to 10', async () => {
  const fakeJobs = Array.from({ length: 15 }, (_, i) => ({
    url: `https://r/${i}`,
    title: `Python Developer ${i}`,
    company_name: 'Acme',
    description: 'Python job',
  }));
  const { restore, getUrls } = stubFetchWithUrl(fakeJobs);
  try {
    const jobs = await createRemotiveSource().search('python', { limit: 10 });
    assert.equal(jobs.length, 10);
    const calledUrl = new URL(getUrls()[0]!);
    assert.equal(calledUrl.searchParams.get('limit'), '200');
  } finally {
    restore();
  }
});

test('query "python developer" drops a job whose text contains only "developer"', async () => {
  const feed = [
    { url: 'https://r/1', title: 'Python Developer', company_name: 'Acme', description: 'Python dev' },
    { url: 'https://r/2', title: 'Frontend Developer', company_name: 'Globex', description: 'React only' },
  ];
  const { restore } = stubFetchWithUrl(feed);
  try {
    const jobs = await createRemotiveSource().search('python developer');
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.title, 'Python Developer');
  } finally {
    restore();
  }
});

test('REMOTIVE_FETCH_LIMIT=75 is honored in the request URL', async () => {
  const prev = process.env.REMOTIVE_FETCH_LIMIT;
  process.env.REMOTIVE_FETCH_LIMIT = '75';
  const { restore, getUrls } = stubFetchWithUrl([]);
  try {
    await createRemotiveSource().search('python');
    const calledUrl = new URL(getUrls()[0]!);
    assert.equal(calledUrl.searchParams.get('limit'), '75');
  } finally {
    if (prev === undefined) delete process.env.REMOTIVE_FETCH_LIMIT;
    else process.env.REMOTIVE_FETCH_LIMIT = prev;
    restore();
  }
});

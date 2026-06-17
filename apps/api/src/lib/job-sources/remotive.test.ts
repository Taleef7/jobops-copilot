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

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTheMuseSource, normalizeTheMuse, type TheMuseRawJob } from './themuse';

test('normalizeTheMuse strips HTML from contents, maps level to seniority, and sets source to themuse', () => {
  const item: TheMuseRawJob = {
    id: 101,
    name: 'Staff Software Engineer',
    contents: '<p>Join us to build <strong>amazing</strong> software.</p><ul><li>Write TypeScript</li></ul>',
    publication_date: '2026-06-01T00:00:00Z',
    company: { name: 'Acme Corp' },
    locations: [{ name: 'San Francisco, CA' }],
    levels: [{ name: 'Senior Level' }],
    refs: { landing_page: 'https://www.themuse.com/jobs/acme/staff-swe' },
  };

  const job = normalizeTheMuse(item);
  assert.equal(job.source, 'themuse');
  assert.equal(job.company, 'Acme Corp');
  assert.equal(job.title, 'Staff Software Engineer');
  assert.equal(job.seniority, 'senior');
  assert.equal(job.jobUrl, 'https://www.themuse.com/jobs/acme/staff-swe');
  assert.ok(!job.descriptionText.includes('<p>'));
  assert.ok(!job.descriptionText.includes('<strong>'));
  assert.ok(job.descriptionText.includes('Join us to build amazing software.'));
  assert.ok(job.descriptionText.includes('Write TypeScript'));

  // Test seniority mappings
  assert.equal(normalizeTheMuse({ ...item, levels: [{ name: 'Entry Level' }] }).seniority, 'junior');
  assert.equal(normalizeTheMuse({ ...item, levels: [{ name: 'Mid Level' }] }).seniority, 'mid');
  assert.equal(normalizeTheMuse({ ...item, levels: [{ name: 'Senior Level' }] }).seniority, 'senior');
  assert.equal(normalizeTheMuse({ ...item, levels: [{ name: 'management' }] }).seniority, 'lead');
  assert.equal(normalizeTheMuse({ ...item, levels: [{ name: 'Director' }] }).seniority, 'lead');
  assert.equal(normalizeTheMuse({ ...item, levels: [{ name: 'Internship' }] }).seniority, 'unknown');
});

test('createTheMuseSource applies AND-filter across query terms', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const urlStr = String(input);
    if (urlStr.includes('page=0')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              id: 1,
              name: 'Python Developer',
              contents: '<p>Backend Python developer</p>',
              company: { name: 'Acme' },
              levels: [{ name: 'Mid Level' }],
              refs: { landing_page: 'https://themuse/1' },
            },
            {
              id: 2,
              name: 'Developer',
              contents: '<p>Java developer only</p>',
              company: { name: 'Globex' },
              levels: [{ name: 'Mid Level' }],
              refs: { landing_page: 'https://themuse/2' },
            },
          ],
        }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    } as Response;
  }) as typeof fetch;

  try {
    const source = createTheMuseSource();
    const results = await source.search('python developer');
    assert.equal(results.length, 1);
    assert.equal(results[0]?.title, 'Python Developer');
    assert.equal(results[0]?.source, 'themuse');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createTheMuseSource honors remoteOnly option', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.searchParams.get('page') === '0') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              id: 1,
              name: 'Remote Engineer',
              contents: '<p>Remote work from home</p>',
              company: { name: 'Acme' },
              locations: [{ name: 'Flexible / Remote' }],
              refs: { landing_page: 'https://themuse/1' },
            },
            {
              id: 2,
              name: 'Onsite Engineer',
              contents: '<p>In-office physical role</p>',
              company: { name: 'Globex' },
              locations: [{ name: 'New York, NY' }],
              refs: { landing_page: 'https://themuse/2' },
            },
          ],
        }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    } as Response;
  }) as typeof fetch;

  try {
    const source = createTheMuseSource();
    const results = await source.search('', { remoteOnly: true });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.title, 'Remote Engineer');
    assert.equal(results[0]?.workplaceType, 'remote');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

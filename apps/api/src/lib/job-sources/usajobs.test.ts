import assert from 'node:assert/strict';
import test from 'node:test';
import { createUsaJobsSource, normalizeUsaJobs, usaJobsConfigured, type UsaJobsRaw } from './usajobs';
import { getJobSources } from './index';

test('normalizeUsaJobs normalizes SearchResultItems fixture and calculates hourly to annual salary', () => {
  const rawItem: UsaJobsRaw = {
    MatchedObjectId: '12345',
    MatchedObjectDescriptor: {
      PositionTitle: 'IT Specialist (Security)',
      OrganizationName: 'Department of Veterans Affairs',
      PositionLocationDisplay: 'Washington, DC',
      PositionURI: 'https://www.usajobs.gov/job/12345',
      PublicationStartDate: '2026-06-01T00:00:00.000Z',
      PositionRemuneration: [
        {
          MinimumRange: '45',
          MaximumRange: '55',
          RateIntervalCode: 'PH',
        },
      ],
      UserArea: {
        Details: {
          JobSummary: 'Summary of IT Specialist role.',
          MajorDuties: ['Defend cyber systems.', 'Monitor networks.'],
        },
      },
    },
  };

  const job = normalizeUsaJobs(rawItem);
  assert.equal(job.source, 'usajobs');
  assert.equal(job.salaryMin, 93600);
  assert.equal(job.salaryMax, 114400);
  assert.equal(job.title, 'IT Specialist (Security)');
  assert.equal(job.company, 'Department of Veterans Affairs');
  assert.equal(job.jobUrl, 'https://www.usajobs.gov/job/12345');
});

test('createUsaJobsSource sends Authorization-Key and User-Agent headers', async () => {
  const prevKey = process.env.USAJOBS_API_KEY;
  const prevAgent = process.env.USAJOBS_USER_AGENT;
  process.env.USAJOBS_API_KEY = 'test-auth-key';
  process.env.USAJOBS_USER_AGENT = 'myemail@example.com';

  let capturedHeaders: unknown;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    capturedHeaders = init?.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        SearchResult: {
          SearchResultItems: [
            {
              MatchedObjectId: '1',
              MatchedObjectDescriptor: {
                PositionTitle: 'Developer',
                OrganizationName: 'GSA',
                PositionURI: 'https://usajobs/1',
                PositionRemuneration: [{ MinimumRange: '45', MaximumRange: '55', RateIntervalCode: 'PH' }],
              },
            },
          ],
        },
      }),
    } as Response;
  }) as typeof fetch;

  try {
    const source = createUsaJobsSource();
    const results = await source.search('developer');
    assert.equal(results.length, 1);
    assert.equal(results[0]?.source, 'usajobs');
    const headers = new Headers(capturedHeaders as Record<string, string>);
    assert.equal(headers.get('Authorization-Key'), 'test-auth-key');
    assert.equal(headers.get('User-Agent'), 'myemail@example.com');
  } finally {
    globalThis.fetch = originalFetch;
    if (prevKey === undefined) delete process.env.USAJOBS_API_KEY;
    else process.env.USAJOBS_API_KEY = prevKey;
    if (prevAgent === undefined) delete process.env.USAJOBS_USER_AGENT;
    else process.env.USAJOBS_USER_AGENT = prevAgent;
  }
});

test('usaJobsConfigured() false without env and getJobSources() omits it', () => {
  const prevKey = process.env.USAJOBS_API_KEY;
  const prevAgent = process.env.USAJOBS_USER_AGENT;
  delete process.env.USAJOBS_API_KEY;
  delete process.env.USAJOBS_USER_AGENT;
  try {
    assert.equal(usaJobsConfigured(), false);
    const sources = getJobSources();
    assert.equal(sources.some((s) => s.name === 'usajobs'), false);
  } finally {
    if (prevKey !== undefined) process.env.USAJOBS_API_KEY = prevKey;
    if (prevAgent !== undefined) process.env.USAJOBS_USER_AGENT = prevAgent;
  }
});

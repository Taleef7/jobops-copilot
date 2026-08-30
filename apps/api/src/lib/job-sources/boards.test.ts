import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TargetCompany } from '@/types';
import {
  htmlToText,
  normalizeGreenhouse,
  normalizeLever,
  normalizeAshby,
  fetchBoardJobs,
  fetchTargetCompanyBoards,
  type GreenhouseRawJob,
  type LeverRawPosting,
  type AshbyRawJob,
} from './boards';

describe('boards job source', () => {
  it('htmlToText unescapes entities and removes HTML tags', () => {
    assert.equal(htmlToText('&lt;p&gt;Hello &lt;b&gt;World&lt;/b&gt;&lt;/p&gt;'), 'Hello World');
    assert.equal(htmlToText(''), '');
  });

  it('normalizes Greenhouse raw job, unescaping entities and stripping HTML tags while extracting salary', () => {
    const raw: GreenhouseRawJob = {
      id: 12345,
      title: 'Database Engineer',
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/12345',
      location: { name: 'San Francisco, CA' },
      content: '&lt;p&gt;Own our &lt;b&gt;Postgres&lt;/b&gt; fleet. $150,000 - $180,000&lt;/p&gt;',
      updated_at: '2026-06-01T12:00:00Z',
    };

    const job = normalizeGreenhouse(raw, 'Acme Corp');

    assert.equal(job.company, 'Acme Corp');
    assert.equal(job.title, 'Database Engineer');
    assert.equal(job.jobUrl, 'https://boards.greenhouse.io/acme/jobs/12345');
    assert.equal(job.location, 'San Francisco, CA');
    assert.equal(job.descriptionText, 'Own our Postgres fleet. $150,000 - $180,000');
    assert.equal(job.salaryMin, 150000);
    assert.equal(job.salaryMax, 180000);
    assert.equal(job.source, 'greenhouse');
  });

  it('normalizes Lever raw posting with lists heading, stripped content, and epoch createdAt as ISO date', () => {
    const raw: LeverRawPosting = {
      id: 'lever-1',
      text: 'Senior Fullstack Engineer',
      hostedUrl: 'https://jobs.lever.co/initech/lever-1',
      createdAt: 1735689600000, // 2025-01-01T00:00:00.000Z
      categories: {
        location: 'Remote, US',
        commitment: 'Full-time',
        workplaceType: 'remote',
      },
      description: '<p>Join our core engineering team.</p>',
      lists: [
        {
          text: 'What you will do',
          content: '<ul><li>Scale distributed services</li><li>Mentor teammates</li></ul>',
        },
      ],
    };

    const job = normalizeLever(raw, 'Initech');

    assert.equal(job.company, 'Initech');
    assert.equal(job.title, 'Senior Fullstack Engineer');
    assert.equal(job.jobUrl, 'https://jobs.lever.co/initech/lever-1');
    assert.equal(job.datePosted, new Date(1735689600000).toISOString());
    assert.equal(job.source, 'lever');
    assert.ok(job.descriptionText?.includes('What you will do'));
    assert.ok(job.descriptionText?.includes('Scale distributed services'));
    assert.ok(!job.descriptionText?.includes('<ul>'));
    assert.ok(!job.descriptionText?.includes('<li>'));
  });

  it('normalizes Ashby raw job with isRemote: true and compensation summary', () => {
    const raw: AshbyRawJob = {
      id: 'ashby-1',
      title: 'Staff AI Engineer',
      jobUrl: 'https://jobs.ashbyhq.com/hooli/ashby-1',
      isRemote: true,
      location: 'Anywhere, US',
      descriptionHtml: '<p>Lead our AI platform developments.</p>',
      compensation: {
        compensationTierSummary: '$140K – $170K',
      },
      publishedAt: '2026-05-15T00:00:00Z',
    };

    const job = normalizeAshby(raw, 'Hooli');

    assert.equal(job.company, 'Hooli');
    assert.equal(job.title, 'Staff AI Engineer');
    assert.equal(job.workplaceType, 'remote');
    assert.equal(job.salaryMin, 140000);
    assert.equal(job.salaryMax, 170000);
    assert.equal(job.source, 'ashby');
  });

  it('fetchBoardJobs rejects a token with path traversal ("a/b") without fetching', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error('fetch should not be called');
    }) as typeof fetch;

    const target: TargetCompany = {
      id: 'tc-1',
      userId: 'user-1',
      company: 'Acme',
      boardType: 'greenhouse',
      boardToken: 'a/b',
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await assert.rejects(fetchBoardJobs(target), /token/i);
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fetchTargetCompanyBoards continues when first target throws and returns only the second target jobs', async () => {
    const originalFetch = globalThis.fetch;

    const target1: TargetCompany = {
      id: 'tc-1',
      userId: 'user-1',
      company: 'FailingCorp',
      boardType: 'greenhouse',
      boardToken: 'failing',
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const target2: TargetCompany = {
      id: 'tc-2',
      userId: 'user-1',
      company: 'SuccessCorp',
      boardType: 'lever',
      boardToken: 'success',
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('failing')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'Internal Server Error' }),
        } as Response;
      }
      if (urlStr.includes('success')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 'job-succ-1',
              text: 'Frontend Architect',
              hostedUrl: 'https://jobs.lever.co/success/job-succ-1',
              createdAt: 1735689600000,
            },
          ],
        } as Response;
      }
      throw new Error(`Unexpected fetch to ${urlStr}`);
    }) as typeof fetch;

    try {
      const jobs = await fetchTargetCompanyBoards([target1, target2]);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]?.title, 'Frontend Architect');
      assert.equal(jobs[0]?.company, 'SuccessCorp');
      assert.equal(jobs[0]?.source, 'lever');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

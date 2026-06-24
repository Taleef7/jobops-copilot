import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreateJobBody, JobRecord, SavedSearch } from '@/types';
import { runDiscoveryForUser, type DiscoveryDeps } from './discovery';
import type { SourcedJob } from '@/lib/job-sources/normalize';

const SEARCH: SavedSearch = {
  id: 's1',
  userId: 'u',
  query: 'ai',
  remoteOnly: false,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

function makeDeps(
  found: SourcedJob[],
  existing: Partial<JobRecord>[],
  resume = 'TypeScript and React engineer.',
): {
  deps: DiscoveryDeps;
  created: CreateJobBody[];
  analyses: Array<{ jobId: string; fitScore?: number | null; modelUsed: string }>;
} {
  const created: CreateJobBody[] = [];
  const analyses: Array<{ jobId: string; fitScore?: number | null; modelUsed: string }> = [];
  let n = 0;
  const deps: DiscoveryDeps = {
    source: { name: 'adzuna', search: async () => found },
    listJobs: async () => existing as unknown as JobRecord[],
    createJob: async (_userId, body) => {
      created.push(body);
      n += 1;
      return { ...(body as object), id: `job-${n}` } as unknown as JobRecord;
    },
    listSavedSearches: async () => [SEARCH],
    getResume: async () => resume,
    saveAnalysis: async (_userId, jobId, analysis, fitScore) => {
      analyses.push({ jobId, fitScore, modelUsed: analysis.modelUsed });
      return undefined;
    },
  };
  return { deps, created, analyses };
}

function sourced(url: string, overrides: Partial<SourcedJob> = {}): SourcedJob {
  return { source: 'adzuna', company: 'A', title: 'T', location: 'L', descriptionText: '', jobUrl: url, ...overrides };
}

test('inserts new jobs and skips duplicates of existing CRM jobs', async () => {
  const { deps, created } = makeDeps(
    [sourced('https://x/1'), sourced('https://x/2', { company: 'B', title: 'T2' })],
    [{ jobUrl: 'https://x/1', company: 'A', title: 'T', location: 'L' }],
  );

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.source, 'adzuna');
  assert.equal(created.length, 1);
  assert.equal(created[0]?.jobUrl, 'https://x/2');
});

test('dedupes repeated postings within the same run', async () => {
  const { deps, created } = makeDeps([sourced('https://dup/1'), sourced('https://dup/1')], []);

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 1);
  assert.equal(result.skipped, 1);
  assert.equal(created.length, 1);
});

test('dedupes a URL-less source copy against a URL-backed CRM job', async () => {
  const urlless: SourcedJob = { source: 'adzuna', company: 'A', title: 'T', location: 'L', descriptionText: '' };
  const { deps, created } = makeDeps(
    [urlless],
    [{ jobUrl: 'https://x/1', company: 'A', title: 'T', location: 'L' }],
  );

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 1);
  assert.equal(created.length, 0);
});

test('dedupes a URL-less source copy against a URL-less CRM job (fingerprint match)', async () => {
  const urlless: SourcedJob = { source: 'adzuna', company: 'A', title: 'T', location: 'L', descriptionText: '' };
  const { deps, created } = makeDeps(
    [urlless],
    [{ company: 'A', title: 'T', location: 'L' }], // existing CRM job with no URL
  );

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 1);
  assert.equal(created.length, 0);
});

test('counts a concurrent duplicate insert (Postgres 23505) as skipped', async () => {
  const created: CreateJobBody[] = [];
  const deps: DiscoveryDeps = {
    source: {
      name: 'adzuna',
      search: async () => [sourced('https://race/1'), sourced('https://race/2', { company: 'B' })],
    },
    listJobs: async () => [],
    createJob: async (_userId, body) => {
      if (body.jobUrl === 'https://race/1') {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
      }
      created.push(body);
      return { ...(body as object), id: 'job-x' } as unknown as JobRecord;
    },
    listSavedSearches: async () => [SEARCH],
    getResume: async () => 'resume',
    saveAnalysis: async () => undefined,
  };

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 1);
  assert.equal(result.skipped, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0]?.jobUrl, 'https://race/2');
});

test('propagates non-duplicate insert errors', async () => {
  const deps: DiscoveryDeps = {
    source: { name: 'adzuna', search: async () => [sourced('https://boom/1')] },
    listJobs: async () => [],
    createJob: async () => {
      throw new Error('db down');
    },
    listSavedSearches: async () => [SEARCH],
    getResume: async () => 'resume',
    saveAnalysis: async () => undefined,
  };

  await assert.rejects(runDiscoveryForUser('u', deps), /db down/);
});

test('pre-ranks each inserted job with a local-prerank analysis', async () => {
  const { deps, analyses } = makeDeps(
    [sourced('https://x/1', { descriptionText: 'We use TypeScript and React.' })],
    [],
  );

  const result = await runDiscoveryForUser('u', deps);

  assert.equal(result.inserted, 1);
  assert.equal(analyses.length, 1);
  assert.equal(analyses[0]?.jobId, 'job-1');
  assert.equal(analyses[0]?.modelUsed, 'local-prerank');
  assert.equal(typeof analyses[0]?.fitScore, 'number');
});

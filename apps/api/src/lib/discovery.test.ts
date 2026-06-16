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
): { deps: DiscoveryDeps; created: CreateJobBody[] } {
  const created: CreateJobBody[] = [];
  const deps: DiscoveryDeps = {
    source: { name: 'adzuna', search: async () => found },
    listJobs: async () => existing as unknown as JobRecord[],
    createJob: async (_userId, body) => {
      created.push(body);
      return body as unknown as JobRecord;
    },
    listSavedSearches: async () => [SEARCH],
  };
  return { deps, created };
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

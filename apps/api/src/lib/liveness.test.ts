import assert from 'node:assert/strict';
import test from 'node:test';
import { runLivenessSweep, type LivenessDeps } from './liveness';

test('runLivenessSweep checks candidates and categorizes status correctly', async () => {
  const updates: Array<{ id: string; liveness: string; touchSeen: boolean }> = [];

  const candidates = [
    { id: 'job-1', jobUrl: 'https://example.com/jobs/1' },
    { id: 'job-2', jobUrl: 'https://example.com/jobs/2' },
    { id: 'job-3', jobUrl: 'https://example.com/jobs/3' },
    { id: 'job-4', jobUrl: 'https://example.com/jobs/4' },
  ];

  const deps: LivenessDeps = {
    listCandidates: async () => candidates,
    fetchPage: async (url: string) => {
      if (url.endsWith('/1')) {
        return { html: '<html>ok</html>' };
      }
      if (url.endsWith('/2')) {
        return { blocked: 'The page returned HTTP 404.' };
      }
      if (url.endsWith('/3')) {
        return { blocked: 'The page returned HTTP 410.' };
      }
      return { blocked: 'Could not reach that page.' };
    },
    updateJobLiveness: async (id, liveness, touchSeen) => {
      updates.push({ id, liveness, touchSeen });
    },
  };

  const result = await runLivenessSweep(deps);

  assert.deepEqual(result, {
    workflow: 'liveness',
    checked: 4,
    active: 1,
    expired: 2,
    stale: 1,
  });

  assert.deepEqual(updates, [
    { id: 'job-1', liveness: 'active', touchSeen: true },
    { id: 'job-2', liveness: 'expired', touchSeen: false },
    { id: 'job-3', liveness: 'expired', touchSeen: false },
    { id: 'job-4', liveness: 'stale', touchSeen: false },
  ]);
});

test('runLivenessSweep returns zeroed result when pool is null', async () => {
  const deps: LivenessDeps = {
    pool: null,
    fetchPage: async () => ({ html: '<html>ok</html>' }),
  };

  const result = await runLivenessSweep(deps);

  assert.deepEqual(result, {
    workflow: 'liveness',
    checked: 0,
    active: 0,
    expired: 0,
    stale: 0,
  });
});

test('runLivenessSweep returns zeroed result when candidates list is empty', async () => {
  const deps: LivenessDeps = {
    listCandidates: async () => [],
    fetchPage: async () => ({ html: '<html>ok</html>' }),
  };

  const result = await runLivenessSweep(deps);

  assert.deepEqual(result, {
    workflow: 'liveness',
    checked: 0,
    active: 0,
    expired: 0,
    stale: 0,
  });
});

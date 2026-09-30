import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJob, getJobById, resetJobStoreForTests } from './job-store';

// #349: a new job has no analysis until a real score succeeds. Every job used to get a
// keyword-based "mock-analysis-v1" at creation, shown as if it were the AI's reading.
test('a newly created job has no analysis and no fit score', async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-no-default-'));
  delete process.env.DATABASE_URL;
  try {
    process.chdir(tempDir);
    await resetJobStoreForTests();
    const job = await createJob('u_fresh', { company: 'Acme', title: 'Engineer', descriptionText: 'Python, PostgreSQL, Docker.' });

    assert.equal(job.analysis, null);
    assert.equal(job.fitScore, null);
    assert.equal((await getJobById('u_fresh', job.id))?.analysis, null);
  } finally {
    process.chdir(originalCwd);
    await resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});

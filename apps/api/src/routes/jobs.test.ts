import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { jobsRouter } from './jobs';
import { resetJobStoreForTests } from '@/data/job-store';
import type { JobRecord } from '@/types';

async function withServer(
  mount: (app: express.Express) => void,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    const header = request.header('X-User-Id');
    if (header) request.userId = header.trim();
    next();
  });
  mount(app);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('no server address');
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('POST /api/jobs accepts and returns enriched schema fields', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL; // force in-memory/file store
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-route-jobs-'));

  try {
    process.chdir(tempDir);
    resetJobStoreForTests();

    await withServer((app) => app.use('/api/jobs', jobsRouter), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'test-user',
        },
        body: JSON.stringify({
          company: 'Acme AI',
          title: 'Principal Architect',
          descriptionText: 'Design distributed agent swarms.',
          salaryMin: 180000,
          salaryMax: 220000,
          salaryCurrency: 'USD',
          seniority: 'lead',
          sponsorLikelihood: 'likely',
          liveness: 'active',
        }),
      });

      assert.equal(response.status, 201);
      const data = (await response.json()) as { job: JobRecord };
      assert.equal(data.job.company, 'Acme AI');
      assert.equal(data.job.title, 'Principal Architect');
      assert.equal(data.job.salaryMin, 180000);
      assert.equal(data.job.salaryMax, 220000);
      assert.equal(data.job.salaryCurrency, 'USD');
      assert.equal(data.job.seniority, 'lead');
      assert.equal(data.job.sponsorLikelihood, 'likely');
      assert.equal(data.job.liveness, 'active');
      assert.match(data.job.contentHash ?? '', /^[0-9a-f]{64}$/);
    });

    await withServer((app) => app.use('/api/jobs', jobsRouter), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'test-user',
        },
        body: JSON.stringify({
          company: 'Acme AI',
          title: 'Staff Engineer',
          descriptionText: 'Staff level cloud distributed systems.',
          sponsorLikelihood: { status: 'known_sponsor', approvals: 15, denials: 2 },
        }),
      });

      assert.equal(response.status, 201);
      const data = (await response.json()) as { job: JobRecord };
      assert.deepEqual(data.job.sponsorLikelihood, {
        status: 'known_sponsor',
        approvals: 15,
        denials: 2,
      });
    });
  } finally {
    process.chdir(originalCwd);
    resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});

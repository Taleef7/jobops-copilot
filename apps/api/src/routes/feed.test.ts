import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { feedRouter } from './feed';
import { createJob, resetJobStoreForTests, updateJob } from '@/data/job-store';
import type { FeedResult } from '@/types';

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

test('GET /api/feed returns ranked jobs with sub-signals and rank reasons', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL; // force in-memory store
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-route-feed-'));

  try {
    process.chdir(tempDir);
    resetJobStoreForTests();

    // Seed jobs
    const job1 = await createJob('user-42', {
      company: 'Anthropic',
      title: 'Senior AI Engineer',
      descriptionText: 'Building frontier LLM systems with TypeScript and Python.',
      seniority: 'senior',
      salaryMin: 180000,
      salaryMax: 220000,
      sponsorLikelihood: 'likely',
    });

    const job2 = await createJob('user-42', {
      company: 'Legacy Corp',
      title: 'Junior Maintenance Dev',
      descriptionText: 'Maintain legacy COBOL systems.',
      seniority: 'junior',
      sponsorLikelihood: 'unlikely',
    });

    // Update job1 score and status to interview to test outcome feedback
    await updateJob('user-42', job1.id, {
      fitScore: 90,
      status: 'interview',
    });

    await updateJob('user-42', job2.id, {
      fitScore: 40,
    });

    await withServer((app) => app.use('/api/feed', feedRouter), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/feed`, {
        headers: {
          'X-User-Id': 'user-42',
        },
      });

      assert.equal(response.status, 200);
      assert.ok(response.headers.get('X-Total-Count'));

      const data = (await response.json()) as FeedResult;
      assert.equal(data.total, 2);
      assert.equal(data.items.length, 2);

      // First ranked item should be the high-fit job1
      const first = data.items[0];
      assert.ok(first);
      assert.equal(first.job.id, job1.id);
      assert.ok(first.adjustedScore !== null && first.adjustedScore >= 90);
      assert.ok(first.subSignals);
      assert.ok(Array.isArray(first.rankReasons));
      assert.ok(first.rankReasons.length > 0);

      // Second item should be job2
      const second = data.items[1];
      assert.ok(second);
      assert.equal(second.job.id, job2.id);
    });
  } finally {
    process.chdir(originalCwd);
  }
});

test('GET /api/feed respects min_score, seniority, and sponsor_only filters', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-route-feed-filters-'));

  try {
    process.chdir(tempDir);
    resetJobStoreForTests();

    const j1 = await createJob('user-filter', {
      company: 'Tech Alpha',
      title: 'Staff Engineer',
      descriptionText: 'TypeScript and Kubernetes.',
      seniority: 'lead',
      sponsorLikelihood: 'likely',
    });
    await updateJob('user-filter', j1.id, { fitScore: 85 });

    const j2 = await createJob('user-filter', {
      company: 'Tech Beta',
      title: 'Junior Engineer',
      descriptionText: 'HTML and CSS.',
      seniority: 'junior',
      sponsorLikelihood: 'unlikely',
    });
    await updateJob('user-filter', j2.id, { fitScore: 50 });

    await withServer((app) => app.use('/api/feed', feedRouter), async (baseUrl) => {
      // Filter by min_score=80
      const scoreRes = await fetch(`${baseUrl}/api/feed?min_score=80`, {
        headers: { 'X-User-Id': 'user-filter' },
      });
      const scoreData = (await scoreRes.json()) as FeedResult;
      assert.equal(scoreData.items.length, 1);
      assert.equal(scoreData.items[0]?.job.id, j1.id);

      // Filter by seniority=lead
      const seniorityRes = await fetch(`${baseUrl}/api/feed?seniority=lead`, {
        headers: { 'X-User-Id': 'user-filter' },
      });
      const seniorityData = (await seniorityRes.json()) as FeedResult;
      assert.equal(seniorityData.items.length, 1);
      assert.equal(seniorityData.items[0]?.job.id, j1.id);

      // Filter by sponsor_only=true
      const sponsorRes = await fetch(`${baseUrl}/api/feed?sponsor_only=true`, {
        headers: { 'X-User-Id': 'user-filter' },
      });
      const sponsorData = (await sponsorRes.json()) as FeedResult;
      assert.equal(sponsorData.items.length, 1);
      assert.equal(sponsorData.items[0]?.job.id, j1.id);
    });
  } finally {
    process.chdir(originalCwd);
  }
});

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { createJob } from '@/data/job-store';
import { resetResumeVersionStore } from '@/data/resume-version-store';
import { upsertUserProfile } from '@/data/profile-store';
import { resumeStudioRouter } from './resume-studio';
import type { StructuredResume } from '@/types';

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

const sampleBaseResume: StructuredResume = {
  basics: {
    name: 'Alex Engineer',
    email: 'alex@example.com',
    summary: 'Cloud systems and backend specialist.',
  },
  work: [
    {
      company: 'Tech Corp',
      position: 'Staff Engineer',
      startDate: '2020-01-01',
      highlights: ['Designed distributed pipeline', 'Reduced costs by 30%'],
    },
  ],
  education: [
    {
      institution: 'Stanford University',
      area: 'Computer Science',
      studyType: 'B.S.',
    },
  ],
  skills: [
    {
      category: 'Languages',
      skills: ['Go', 'Python', 'TypeScript'],
    },
  ],
};

test('POST /api/jobs/:id/tailor starts a tailoring run and creates draft version', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-studio-test-'));

  try {
    process.chdir(tempDir);
    await resetResumeVersionStore();

    // Create job and profile with base resume
    const job = await createJob('user-studio-1', {
      company: 'DataFlow Systems',
      title: 'Principal Distributed Systems Engineer',
      descriptionText: 'Building massive-scale data processing engines with Go and Kafka.',
    });
    await upsertUserProfile('user-studio-1', { baseResume: sampleBaseResume });

    await withServer(
      (app) => app.use('/api', resumeStudioRouter),
      async (baseUrl) => {
        // Start tailoring
        const tailorRes = await fetch(`${baseUrl}/api/jobs/${job.id}/tailor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user-studio-1' },
          body: JSON.stringify({}),
        });

        assert.equal(tailorRes.status, 201);
        const data = (await tailorRes.json()) as {
          status: string;
          version: { id: string; approved: boolean; changeSummary: string; changeDetails: unknown[] };
          threadId: string;
        };
        assert.equal(data.status, 'awaiting_approval');
        assert.equal(data.version.approved, false);
        assert.ok(data.version.id);
        assert.ok(data.version.changeDetails.length > 0);

        // List versions for the job
        const listRes = await fetch(`${baseUrl}/api/jobs/${job.id}/resume-versions`, {
          headers: { 'X-User-Id': 'user-studio-1' },
        });
        assert.equal(listRes.status, 200);
        const listData = (await listRes.json()) as { versions: Array<{ id: string; approved: boolean }> };
        assert.equal(listData.versions.length, 1);
        assert.equal(listData.versions[0]!.id, data.version.id);
        assert.equal(listData.versions[0]!.approved, false);

        // Approve the version: renders PDF and updates approved=true
        const approveRes = await fetch(`${baseUrl}/api/resume-versions/${data.version.id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user-studio-1' },
          body: JSON.stringify({}),
        });
        assert.equal(approveRes.status, 200);
        const approveData = (await approveRes.json()) as {
          approved: boolean;
          fileUrl: string;
          version: { approved: boolean; tailoredResumeFileUrl: string };
        };
        assert.equal(approveData.approved, true);
        assert.equal(approveData.version.approved, true);
        assert.ok(approveData.fileUrl);

        // Gated download
        const downloadRes = await fetch(`${baseUrl}/api/resume-versions/${data.version.id}/download`, {
          headers: { 'X-User-Id': 'user-studio-1' },
        });
        assert.equal(downloadRes.status, 200);
        assert.equal(downloadRes.headers.get('content-type'), 'application/pdf');
        const pdfBuf = Buffer.from(await downloadRes.arrayBuffer());
        assert.ok(pdfBuf.toString('utf-8', 0, 8).startsWith('%PDF-1.4'));
      },
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test('POST /api/resume-versions/:id/reject records feedback', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-studio-reject-'));

  try {
    process.chdir(tempDir);
    await resetResumeVersionStore();

    const job = await createJob('user-studio-2', {
      company: 'ScaleCorp',
      title: 'Backend Engineer',
      descriptionText: 'Building microservices.',
    });
    await upsertUserProfile('user-studio-2', { baseResume: sampleBaseResume });

    await withServer(
      (app) => app.use('/api', resumeStudioRouter),
      async (baseUrl) => {
        const tailorRes = await fetch(`${baseUrl}/api/jobs/${job.id}/tailor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user-studio-2' },
        });
        const data = (await tailorRes.json()) as { version: { id: string } };

        // Reject with feedback
        const rejectRes = await fetch(`${baseUrl}/api/resume-versions/${data.version.id}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user-studio-2' },
          body: JSON.stringify({ feedback: 'Please highlight Go concurrency more.' }),
        });

        assert.equal(rejectRes.status, 200);
        const rejectData = (await rejectRes.json()) as {
          approved: boolean;
          feedback: string;
          version: { changeSummary: string };
        };
        assert.equal(rejectData.approved, false);
        assert.equal(rejectData.feedback, 'Please highlight Go concurrency more.');
        assert.ok(rejectData.version.changeSummary.includes('Please highlight Go concurrency more.'));
      },
    );
  } finally {
    process.chdir(originalCwd);
  }
});

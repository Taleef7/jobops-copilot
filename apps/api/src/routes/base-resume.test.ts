import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { baseResumeRouter } from './base-resume';
import { demoRouter } from './demo';
import { resetResumeVersionStore } from '@/data/resume-version-store';
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

const sampleResume: StructuredResume = {
  basics: {
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+1-555-0100',
    summary: 'Senior software engineer with 8 years of experience.',
  },
  work: [
    {
      company: 'Acme Corp',
      position: 'Senior Engineer',
      startDate: '2020-01-01',
      current: true,
      highlights: ['Led migration to microservices', 'Reduced latency by 40%'],
    },
  ],
  education: [
    {
      institution: 'MIT',
      area: 'Computer Science',
      studyType: 'BS',
      endDate: '2016-05-15',
    },
  ],
  skills: [
    { category: 'Languages', skills: ['TypeScript', 'Python', 'Go'] },
    { category: 'Cloud', skills: ['AWS', 'GCP'] },
  ],
};

test('GET /api/profile/base-resume returns null when no base resume exists', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-base-resume-'));

  try {
    process.chdir(tempDir);
    await resetResumeVersionStore();

    await withServer(
      (app) => app.use('/api/profile/base-resume', baseResumeRouter),
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/profile/base-resume`, {
          headers: { 'X-User-Id': 'user-br-1' },
        });
        assert.equal(res.status, 200);
        const data = (await res.json()) as { baseResume: StructuredResume | null };
        assert.equal(data.baseResume, null);
      },
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test('PUT /api/profile/base-resume saves and GET retrieves the structured resume', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-base-resume-put-'));

  try {
    process.chdir(tempDir);
    await resetResumeVersionStore();

    await withServer(
      (app) => app.use('/api/profile/base-resume', baseResumeRouter),
      async (baseUrl) => {
        // PUT the base resume
        const putRes = await fetch(`${baseUrl}/api/profile/base-resume`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user-br-2' },
          body: JSON.stringify({ baseResume: sampleResume }),
        });
        assert.equal(putRes.status, 200);
        const putData = (await putRes.json()) as { baseResume: StructuredResume };
        assert.equal(putData.baseResume.basics.name, 'Jane Doe');
        assert.equal(putData.baseResume.work?.length, 1);

        // GET should now return it
        const getRes = await fetch(`${baseUrl}/api/profile/base-resume`, {
          headers: { 'X-User-Id': 'user-br-2' },
        });
        assert.equal(getRes.status, 200);
        const getData = (await getRes.json()) as { baseResume: StructuredResume };
        assert.equal(getData.baseResume.basics.name, 'Jane Doe');
        assert.equal(getData.baseResume.basics.email, 'jane@example.com');
        assert.deepEqual(getData.baseResume.skills?.[0]?.skills, ['TypeScript', 'Python', 'Go']);
      },
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test('PUT /api/profile/base-resume rejects payload without basics.name', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-base-resume-bad-'));

  try {
    process.chdir(tempDir);
    await resetResumeVersionStore();

    await withServer(
      (app) => app.use('/api/profile/base-resume', baseResumeRouter),
      async (baseUrl) => {
        // Missing basics.name
        const res = await fetch(`${baseUrl}/api/profile/base-resume`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user-br-3' },
          body: JSON.stringify({ baseResume: { basics: {} } }),
        });
        assert.equal(res.status, 400);
        const data = (await res.json()) as { error: string };
        assert.ok(data.error.includes('basics.name'));
      },
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test('POST /api/profile/base-resume/parse-resume returns structured resume (mock fallback)', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  delete process.env.AGENT_SERVICE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-base-resume-parse-'));

  try {
    process.chdir(tempDir);
    await resetResumeVersionStore();

    await withServer(
      (app) => app.use('/api/profile/base-resume', baseResumeRouter),
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/profile/base-resume/parse-resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user-br-4' },
          body: JSON.stringify({
            resume_text:
              'Jane Doe\nSenior Software Engineer\njane.doe@example.com\n+1-555-0100\n\n' +
              'Experience:\n- Led team of 5 at Acme Corp building distributed systems\n' +
              '- Reduced API latency by 40%\n\nSkills: TypeScript, Python, Go, AWS',
          }),
        });
        assert.equal(res.status, 200);
        const data = (await res.json()) as { structuredResume: StructuredResume };
        assert.ok(data.structuredResume);
        assert.ok(data.structuredResume.basics);
        // Mock parser extracts first line as name, email from text
        assert.equal(data.structuredResume.basics.name, 'Jane Doe');
        assert.ok(data.structuredResume.basics.email.includes('example.com'));
      },
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test('POST /api/profile/base-resume/parse-resume returns 400 when no resume text', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-base-resume-notext-'));

  try {
    process.chdir(tempDir);
    await resetResumeVersionStore();

    await withServer(
      (app) => app.use('/api/profile/base-resume', baseResumeRouter),
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/profile/base-resume/parse-resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user-br-5' },
          body: JSON.stringify({}),
        });
        assert.equal(res.status, 400);
        const data = (await res.json()) as { error: string };
        assert.ok(data.error.includes('resume'));
      },
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test('PUT /api/profile/base-resume updates an existing base version (idempotent)', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-base-resume-update-'));

  try {
    process.chdir(tempDir);
    await resetResumeVersionStore();

    await withServer(
      (app) => app.use('/api/profile/base-resume', baseResumeRouter),
      async (baseUrl) => {
        const headers = { 'Content-Type': 'application/json', 'X-User-Id': 'user-br-6' };

        // First PUT — creates the base
        const put1 = await fetch(`${baseUrl}/api/profile/base-resume`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ baseResume: sampleResume }),
        });
        assert.equal(put1.status, 200);

        // Second PUT — updates the base (different summary)
        const updatedResume = {
          ...sampleResume,
          basics: { ...sampleResume.basics, summary: 'Updated summary with 10 years exp.' },
        };
        const put2 = await fetch(`${baseUrl}/api/profile/base-resume`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ baseResume: updatedResume }),
        });
        assert.equal(put2.status, 200);

        // GET should return the updated version
        const getRes = await fetch(`${baseUrl}/api/profile/base-resume`, {
          headers: { 'X-User-Id': 'user-br-6' },
        });
        const data = (await getRes.json()) as { baseResume: StructuredResume };
        assert.equal(data.baseResume.basics.summary, 'Updated summary with 10 years exp.');
      },
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test('GET /api/profile/base-resume is user-scoped (tenant isolation)', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-base-resume-tenant-'));

  try {
    process.chdir(tempDir);
    await resetResumeVersionStore();

    await withServer(
      (app) => app.use('/api/profile/base-resume', baseResumeRouter),
      async (baseUrl) => {
        // User A saves a base resume
        await fetch(`${baseUrl}/api/profile/base-resume`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user-A' },
          body: JSON.stringify({ baseResume: sampleResume }),
        });

        // User B should not see User A's base resume
        const res = await fetch(`${baseUrl}/api/profile/base-resume`, {
          headers: { 'X-User-Id': 'user-B' },
        });
        assert.equal(res.status, 200);
        const data = (await res.json()) as { baseResume: null };
        assert.equal(data.baseResume, null);
      },
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test('POST /api/demo/clear deletes base resume versions so GET returns null after clear', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-base-resume-clear-'));

  try {
    process.chdir(tempDir);
    await resetResumeVersionStore();

    await withServer(
      (app) => {
        app.use('/api/profile/base-resume', baseResumeRouter);
        app.use('/api/demo', demoRouter);
      },
      async (baseUrl) => {
        const headers = { 'Content-Type': 'application/json', 'X-User-Id': 'user-clear-1' };

        // 1. Save a base resume
        const putRes = await fetch(`${baseUrl}/api/profile/base-resume`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ baseResume: sampleResume }),
        });
        assert.equal(putRes.status, 200);

        // Verify it was saved
        const getRes1 = await fetch(`${baseUrl}/api/profile/base-resume`, {
          headers: { 'X-User-Id': 'user-clear-1' },
        });
        const data1 = (await getRes1.json()) as { baseResume: StructuredResume };
        assert.equal(data1.baseResume.basics.name, 'Jane Doe');

        // 2. Clear user data
        const clearRes = await fetch(`${baseUrl}/api/demo/clear`, {
          method: 'POST',
          headers,
        });
        assert.equal(clearRes.status, 200);

        // 3. GET should return null, not resurrect from orphaned resume_versions
        const getRes2 = await fetch(`${baseUrl}/api/profile/base-resume`, {
          headers: { 'X-User-Id': 'user-clear-1' },
        });
        const data2 = (await getRes2.json()) as { baseResume: null };
        assert.equal(data2.baseResume, null);
      },
    );
  } finally {
    process.chdir(originalCwd);
  }
});


import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { baseResumeRouter } from './base-resume';
import { demoRouter } from './demo';
import { getUserProfile, upsertUserProfile } from '@/data/profile-store';
import { resetResumeVersionStore } from '@/data/resume-version-store';
import type { StructuredResume } from '@/types';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { FAKE_STRUCTURED_RESUME, fakeAgentAnswer } from '@/test-support/fake-agent';

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
  app.use(apiErrorHandler);
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
        const data = (await res.json()) as { baseResume: StructuredResume | null; updatedAt: string | null };
        assert.equal(data.baseResume, null);
        assert.equal(data.updatedAt, null);
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
        // #350: Settings shows when the résumé was last saved.
        const { updatedAt } = getData as unknown as { updatedAt: string | null };
        assert.ok(updatedAt && !Number.isNaN(Date.parse(updatedAt)), `updatedAt: ${updatedAt}`);
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

// #350: a replacement file's text is stored with the résumé read from it, in one write, so a
// failed save can't leave the new text beside the old résumé.
test('PUT /api/profile/base-resume stores a replacement file\'s text with the résumé', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-base-resume-text-'));

  try {
    process.chdir(tempDir);
    await resetResumeVersionStore();
    await upsertUserProfile('user-br-text', { resumeText: 'Old text', resumeFileName: 'old.pdf' });

    await withServer(
      (app) => app.use('/api/profile/base-resume', baseResumeRouter),
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/profile/base-resume`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user-br-text' },
          body: JSON.stringify({ baseResume: sampleResume, resumeText: ' New text ', resumeFileName: 'new.pdf' }),
        });
        assert.equal(res.status, 200);

        const profile = await getUserProfile('user-br-text');
        assert.equal(profile?.resumeText, 'New text');
        assert.equal(profile?.resumeFileName, 'new.pdf');
        assert.equal(profile?.baseResume?.basics.name, 'Jane Doe');
      },
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test('PUT /api/profile/base-resume that is refused stores neither the text nor the résumé', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-base-resume-text-bad-'));

  try {
    process.chdir(tempDir);
    await resetResumeVersionStore();
    await upsertUserProfile('user-br-text-bad', { resumeText: 'Old text', resumeFileName: 'old.pdf' });

    await withServer(
      (app) => app.use('/api/profile/base-resume', baseResumeRouter),
      async (baseUrl) => {
        const put = (body: unknown) =>
          fetch(`${baseUrl}/api/profile/base-resume`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user-br-text-bad' },
            body: JSON.stringify(body),
          });

        assert.equal((await put({ baseResume: { basics: {} }, resumeText: 'New text' })).status, 400);
        assert.equal((await put({ baseResume: sampleResume, resumeText: '   ' })).status, 400);
        assert.equal((await put({ baseResume: sampleResume, resumeText: 42 })).status, 400);
        assert.equal((await put({ baseResume: sampleResume, resumeText: 'r'.repeat(100_001) })).status, 413);

        const profile = await getUserProfile('user-br-text-bad');
        assert.equal(profile?.resumeText, 'Old text');
        assert.equal(profile?.resumeFileName, 'old.pdf');
        assert.equal(profile?.baseResume ?? null, null);
      },
    );
  } finally {
    process.chdir(originalCwd);
  }
});

// #349: a résumé import is the AI's reading of the résumé, or an error to retry. It used to
// return a keyword guess labelled as a parse.
test('POST /api/profile/base-resume/parse-resume answers 503 retryable when the AI is unavailable', async () => {
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
          body: JSON.stringify({ resume_text: 'Jane Doe\nSenior Software Engineer\njane.doe@example.com' }),
        });
        assert.equal(res.status, 503);
        const data = (await res.json()) as { error: string; retryable: boolean };
        assert.equal(data.retryable, true);
        assert.ok(data.error.length > 0);
      },
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test('POST /api/profile/base-resume/parse-resume returns the AI reading of the résumé', async () => {
  const originalCwd = process.cwd();
  const savedAgent = process.env.AGENT_SERVICE_URL;
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-base-resume-parse-ai-'));
  const agent = http.createServer((request, response) => {
    request.resume();
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(fakeAgentAnswer(request.url)));
  });
  await new Promise<void>((resolve) => agent.listen(0, resolve));
  const agentAddress = agent.address();
  if (!agentAddress || typeof agentAddress === 'string') throw new Error('no agent address');
  process.env.AGENT_SERVICE_URL = `http://127.0.0.1:${agentAddress.port}`;

  try {
    process.chdir(tempDir);
    await resetResumeVersionStore();

    await withServer(
      (app) => app.use('/api/profile/base-resume', baseResumeRouter),
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/profile/base-resume/parse-resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user-br-5' },
          body: JSON.stringify({ resume_text: 'Ada Lovelace. Backend engineer at Globex.' }),
        });
        assert.equal(res.status, 200);
        const data = (await res.json()) as { structuredResume: StructuredResume };
        assert.equal(data.structuredResume.basics.name, 'Ada Lovelace');
        assert.equal(data.structuredResume.work[0]?.company, 'Globex');
        assert.deepEqual(data.structuredResume.skills[0]?.skills, ['Go', 'Python']);
        assert.deepEqual((data as unknown as { flags: unknown[] }).flags, []);
      },
    );
  } finally {
    process.chdir(originalCwd);
    if (savedAgent === undefined) delete process.env.AGENT_SERVICE_URL;
    else process.env.AGENT_SERVICE_URL = savedAgent;
    agent.closeAllConnections();
    await new Promise<void>((resolve) => agent.close(() => resolve()));
  }
});

// #350: fields that look misread come back flagged, for the confirmation screen to hold.
test('POST /api/profile/base-resume/parse-resume flags a bullet word read as an employer', async () => {
  const originalCwd = process.cwd();
  const savedAgent = process.env.AGENT_SERVICE_URL;
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-base-resume-parse-flags-'));
  const agent = http.createServer((request, response) => {
    request.resume();
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        ...FAKE_STRUCTURED_RESUME,
        work: [
          {
            company: 'Encoded9',
            position: 'Software Developer',
            start_date: '2026-05',
            highlights: ['Encoded 9 regulatory measures as documented business rules'],
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => agent.listen(0, resolve));
  const agentAddress = agent.address();
  if (!agentAddress || typeof agentAddress === 'string') throw new Error('no agent address');
  process.env.AGENT_SERVICE_URL = `http://127.0.0.1:${agentAddress.port}`;

  try {
    process.chdir(tempDir);
    await resetResumeVersionStore();
    await withServer(
      (app) => app.use('/api/profile/base-resume', baseResumeRouter),
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/profile/base-resume/parse-resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user-br-flags' },
          body: JSON.stringify({ resume_text: 'Medical Informatics EngineeringMay 2026 Encoded9 regulatory measures' }),
        });
        assert.equal(res.status, 200);
        const data = (await res.json()) as { flags: Array<{ path: string; value: string; reason: string }> };
        assert.deepEqual(
          data.flags.map((flag) => [flag.path, flag.value]),
          [['work[0].company', 'Encoded9']],
        );
      },
    );
  } finally {
    process.chdir(originalCwd);
    if (savedAgent === undefined) delete process.env.AGENT_SERVICE_URL;
    else process.env.AGENT_SERVICE_URL = savedAgent;
    agent.closeAllConnections();
    await new Promise<void>((resolve) => agent.close(() => resolve()));
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

test('POST /api/profile/base-resume/render-pdf renders ATS PDF and stores version', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-base-resume-pdf-'));

  try {
    process.chdir(tempDir);
    await resetResumeVersionStore();

    await withServer(
      (app) => app.use('/api/profile/base-resume', baseResumeRouter),
      async (baseUrl) => {
        // Save base resume first
        await fetch(`${baseUrl}/api/profile/base-resume`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user-pdf-1' },
          body: JSON.stringify({ baseResume: sampleResume }),
        });

        // Request PDF rendering
        const renderRes = await fetch(`${baseUrl}/api/profile/base-resume/render-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user-pdf-1' },
          body: JSON.stringify({}),
        });

        assert.equal(renderRes.status, 200);
        const data = (await renderRes.json()) as {
          versionId: string;
          fileUrl: string;
          fileName: string;
        };
        assert.ok(data.versionId);
        assert.ok(data.fileUrl);
        assert.ok(data.fileName.endsWith('.pdf'));

        // Verify download route returns valid PDF binary
        const downloadRes = await fetch(`${baseUrl}/api/profile/base-resume/versions/${data.versionId}/download`, {
          headers: { 'X-User-Id': 'user-pdf-1' },
        });

        assert.equal(downloadRes.status, 200);
        assert.equal(downloadRes.headers.get('content-type'), 'application/pdf');
        const buf = Buffer.from(await downloadRes.arrayBuffer());
        assert.ok(buf.toString('utf-8', 0, 8).startsWith('%PDF-1.4'));
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


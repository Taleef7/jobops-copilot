import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '@/app';
import { resetAgentOutputStoreForTests } from '@/data/agent-output-store';
import { _resetApplicationAnswerStoreForTests, upsertApplicationAnswer } from '@/data/application-answer-store';
import { createJob, resetJobStoreForTests } from '@/data/job-store';
import { upsertUserProfile } from '@/data/profile-store';
import { insertResumeVersion, resetResumeVersionStore } from '@/data/resume-version-store';
import type { ApplicationPackPayload, StructuredResume } from '@/types';

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Test server did not provide a usable address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const USER = 'user_app_pack_test';

function hdrs(userId?: string) {
  return {
    'Content-Type': 'application/json',
    ...(userId ? { 'X-User-Id': userId } : {}),
  };
}

const sampleResume: StructuredResume = {
  basics: {
    name: 'Alex Rivera',
    email: 'alex@example.com',
    phone: '+1 (555) 234-5678',
    summary: 'Senior Cloud Engineer with deep Kubernetes and Go expertise.',
    location: { city: 'Seattle', region: 'WA' },
    profiles: [{ network: 'LinkedIn', url: 'https://linkedin.com/in/alexrivera' }],
  },
  work: [
    {
      company: 'Cloud Scale Inc',
      position: 'Staff Engineer',
      startDate: '2021-03',
      highlights: ['Architected multi-region Kubernetes platform saving $1.2M annually'],
    },
  ],
  education: [
    {
      institution: 'University of Washington',
      studyType: 'B.S.',
      area: 'Computer Science',
    },
  ],
  skills: [
    { category: 'Cloud & DevOps', skills: ['Kubernetes', 'Terraform', 'AWS', 'Go'] },
  ],
};

test('POST and GET /api/jobs/:id/application-pack lifecycle', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-app-pack-test-'));

  try {
    process.chdir(tempDir);
    resetJobStoreForTests();
    resetAgentOutputStoreForTests();
    await _resetApplicationAnswerStoreForTests([]);
    await resetResumeVersionStore();

    // 1. Seed user profile with base resume
    await upsertUserProfile(USER, { baseResume: sampleResume });

    // 2. Seed a job for this user
    const job = await createJob(USER, {
      company: 'Stripe',
      title: 'Infrastructure Engineer',
      descriptionText: 'Looking for a Senior Infrastructure Engineer to scale core payment clusters.',
    });

    // 3. Seed Q&A memory for work authorization
    await upsertApplicationAnswer(USER, {
      questionText: 'Are you legally authorized to work in the United States?',
      answer: 'Yes, US Citizen with active security clearance.',
    });

    // 4. Seed an approved tailored resume version
    await insertResumeVersion({
      id: 'ver-tailored-1',
      userId: USER,
      jobId: job.id,
      changeSummary: 'Tailored for Stripe payment infra',
      structuredResume: sampleResume,
      tailoredResumeFileUrl: 'https://storage.blob.core.windows.net/resumes/stripe-tailored.pdf',
      approved: true,
      isBase: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await withServer(async (baseUrl) => {
      // Step A: GET before generate returns 404
      const getRes1 = await fetch(`${baseUrl}/api/jobs/${job.id}/application-pack`, {
        headers: hdrs(USER),
      });
      assert.equal(getRes1.status, 404);

      // Step B: POST generates the application pack
      const postRes = await fetch(`${baseUrl}/api/jobs/${job.id}/application-pack`, {
        method: 'POST',
        headers: hdrs(USER),
      });
      assert.equal(postRes.status, 201);
      const postData = (await postRes.json()) as { applicationPack: ApplicationPackPayload };
      const pack = postData.applicationPack;

      assert.equal(pack.jobId, job.id);
      assert.equal(pack.company, 'Stripe');
      assert.equal(pack.title, 'Infrastructure Engineer');
      assert.equal(pack.resumeVersionId, 'ver-tailored-1');
      assert.equal(pack.resumeFileUrl, 'https://storage.blob.core.windows.net/resumes/stripe-tailored.pdf');

      // Contact block populated from resume
      assert.equal(pack.contactBlock?.name, 'Alex Rivera');
      assert.equal(pack.contactBlock?.email, 'alex@example.com');
      assert.equal(pack.contactBlock?.linkedin, 'https://linkedin.com/in/alexrivera');

      // Answers populated
      assert.ok(pack.answers.length >= 4);

      // Question 1 answered from QA memory
      const q1 = pack.answers.find((a) => a.category === 'work_authorization');
      assert.ok(q1);
      assert.equal(q1.answer, 'Yes, US Citizen with active security clearance.');
      assert.equal(q1.source, 'qa_memory');

      // Question 4 Why Us grounded in Stripe
      const whyUs = pack.answers.find((a) => a.category === 'why_us');
      assert.ok(whyUs);
      assert.match(whyUs.answer, /Stripe/i);

      // Step C: GET after generate returns 200 with the saved pack
      const getRes2 = await fetch(`${baseUrl}/api/jobs/${job.id}/application-pack`, {
        headers: hdrs(USER),
      });
      assert.equal(getRes2.status, 200);
      const getData = (await getRes2.json()) as { applicationPack: ApplicationPackPayload };
      assert.equal(getData.applicationPack.jobId, job.id);
      assert.equal(getData.applicationPack.contactBlock?.name, 'Alex Rivera');

      // Step D: Tenant isolation - another user cannot access
      const getResOther = await fetch(`${baseUrl}/api/jobs/${job.id}/application-pack`, {
        headers: hdrs('another_user'),
      });
      assert.equal(getResOther.status, 404);
    });
  } finally {
    process.chdir(originalCwd);
    resetJobStoreForTests();
    resetAgentOutputStoreForTests();
    await _resetApplicationAnswerStoreForTests([]);
    await resetResumeVersionStore();
    await rm(tempDir, { recursive: true, force: true });
  }
});

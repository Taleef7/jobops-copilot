import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '@/app';
import { createExtToken, _resetExtTokenStoreForTests } from '@/data/ext-token-store';
import { createJob, getJobById, resetJobStoreForTests } from '@/data/job-store';
import { upsertApplicationAnswer, _resetApplicationAnswerStoreForTests } from '@/data/application-answer-store';
import { insertResumeVersion, resetResumeVersionStore } from '@/data/resume-version-store';
import type { JobRecord } from '@/types';

const USER = 'user_ext_data_test';

async function withServer(run: (baseUrl: string, token: string) => Promise<void>) {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const dir = await mkdtemp(join(tmpdir(), 'jobops-ext-data-test-'));
  try {
    process.chdir(dir);
    await _resetExtTokenStoreForTests([]);
    await resetJobStoreForTests();
    await _resetApplicationAnswerStoreForTests([]);
    await resetResumeVersionStore();

    const { token } = await createExtToken(USER, 'Test Chrome PAT');

    const app = createApp({
      runLimiter: (_req, _res, next) => next(),
      runBudget: (_req, _res, next) => next(),
    });
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
      await run(baseUrl, token);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    process.chdir(originalCwd);
    await _resetExtTokenStoreForTests([]);
    await resetJobStoreForTests();
    await _resetApplicationAnswerStoreForTests([]);
    await resetResumeVersionStore();
    await rm(dir, { recursive: true, force: true });
  }
}

function hdrs(token: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

test('GET /api/ext/match resolves job by URL and generates application pack', async () => {
  await withServer(async (baseUrl, token) => {
    const job = await createJob(USER, {
      company: 'Acme Corp',
      title: 'Senior Frontend Engineer',
      jobUrl: 'https://boards.greenhouse.io/acme/jobs/456789',
      source: 'manual',
      descriptionText: 'React, TypeScript and modern web applications.',
    });

    // 1. Exact match
    const res1 = await fetch(
      `${baseUrl}/api/ext/match?url=${encodeURIComponent('https://boards.greenhouse.io/acme/jobs/456789')}`,
      { headers: hdrs(token) },
    );
    assert.equal(res1.status, 200);
    const body1 = (await res1.json()) as { matched: boolean; job: JobRecord; applicationPack: { answers: unknown[] } };
    assert.equal(body1.matched, true);
    assert.equal(body1.job.id, job.id);
    assert.equal(body1.job.company, 'Acme Corp');
    assert.ok(body1.applicationPack);
    assert.equal(body1.applicationPack.answers.length, 5);

    // 2. Normalized URL match (with tracking query and trailing slash)
    const res2 = await fetch(
      `${baseUrl}/api/ext/match?url=${encodeURIComponent('https://boards.greenhouse.io/acme/jobs/456789/?gh_jid=456789&utm_source=linkedin')}`,
      { headers: hdrs(token) },
    );
    assert.equal(res2.status, 200);
    const body2 = (await res2.json()) as { matched: boolean; job: JobRecord };
    assert.equal(body2.matched, true);
    assert.equal(body2.job.id, job.id);

    // 3. Unmatched URL returns matched: false with recent jobs
    const res3 = await fetch(
      `${baseUrl}/api/ext/match?url=${encodeURIComponent('https://jobs.lever.co/unknown/99999')}`,
      { headers: hdrs(token) },
    );
    assert.equal(res3.status, 200);
    const body3 = (await res3.json()) as { matched: boolean; job: null; recentJobs: JobRecord[] };
    assert.equal(body3.matched, false);
    assert.equal(body3.job, null);
    assert.equal(body3.recentJobs.length, 1);
    assert.equal(body3.recentJobs[0]?.id, job.id);
  });
});

test('GET /api/ext/profile-fill returns structured profile, work history, and answers', async () => {
  await withServer(async (baseUrl, token) => {
    // Seed base resume
    await insertResumeVersion({
      id: randomUUID(),
      userId: USER,
      isBase: true,
      approved: true,
      changeSummary: 'Initial base resume for test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      structuredResume: {
        basics: {
          name: 'Sarah Connor',
          email: 'sarah@example.com',
          phone: '+1 555-0199',
          summary: 'Lead System Engineer and Automation Specialist',
          location: { city: 'Los Angeles', region: 'CA' },
          profiles: [
            { network: 'LinkedIn', url: 'https://linkedin.com/in/sarah-connor' },
            { network: 'GitHub', url: 'https://github.com/sarah-connor' },
          ],
        },
        work: [
          {
            company: 'Cyberdyne Systems',
            position: 'Senior Security Engineer',
            startDate: '2021-01',
            endDate: '2026-01',
            highlights: ['Architected defensive automated perimeter monitoring'],
          },
        ],
        education: [
          {
            institution: 'MIT',
            studyType: 'B.S.',
            area: 'Computer Science',
          },
        ],
        skills: [{ category: 'Core', skills: ['TypeScript', 'Python', 'Security'] }],
      },
    });

    // Seed Q&A answer
    await upsertApplicationAnswer(USER, {
      questionText: 'What is your target base salary?',
      answer: '$175,000 USD base',
    });

    const res = await fetch(`${baseUrl}/api/ext/profile-fill`, {
      headers: hdrs(token),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      profile: Record<string, string | Record<string, boolean>>;
      workExperience: unknown[];
      education: unknown[];
      skills: string[];
      answers: Record<string, string>;
    };

    assert.equal(body.profile.fullName, 'Sarah Connor');
    assert.equal(body.profile.firstName, 'Sarah');
    assert.equal(body.profile.lastName, 'Connor');
    assert.equal(body.profile.email, 'sarah@example.com');
    assert.equal(body.profile.phone, '+1 555-0199');
    assert.equal(body.profile.city, 'Los Angeles');
    assert.equal(body.profile.state, 'CA');
    assert.equal(body.profile.linkedinUrl, 'https://linkedin.com/in/sarah-connor');
    assert.equal(body.profile.githubUrl, 'https://github.com/sarah-connor');
    assert.equal(body.profile.currentCompany, 'Cyberdyne Systems');
    assert.equal(body.profile.currentTitle, 'Senior Security Engineer');
    assert.equal(body.workExperience.length, 1);
    assert.equal(body.education.length, 1);
    assert.ok(body.skills.includes('TypeScript'));
    assert.equal(body.answers['what is your target base salary?'], '$175,000 USD base');
  });
});

test('GET & POST /api/ext/answers manages Q&A memory from extension', async () => {
  await withServer(async (baseUrl, token) => {
    // 1. Post new answer
    const postRes = await fetch(`${baseUrl}/api/ext/answers`, {
      method: 'POST',
      headers: hdrs(token),
      body: JSON.stringify({
        questionText: 'Are you willing to relocate?',
        answer: 'Yes, open to relocation for hybrid or onsite roles in SF/NYC.',
        ats: 'greenhouse',
      }),
    });
    assert.equal(postRes.status, 201);
    const postBody = (await postRes.json()) as { answer: { questionText: string; answer: string } };
    assert.equal(postBody.answer.questionText, 'Are you willing to relocate?');
    assert.equal(postBody.answer.answer, 'Yes, open to relocation for hybrid or onsite roles in SF/NYC.');

    // 2. Query answers
    const listRes = await fetch(`${baseUrl}/api/ext/answers?q=relocate`, {
      headers: hdrs(token),
    });
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as { answers: { questionText: string; answer: string }[] };
    assert.equal(listBody.answers.length, 1);
    assert.equal(listBody.answers[0]?.questionText, 'Are you willing to relocate?');
  });
});

test('POST /api/ext/applications captures submission on existing and new jobs', async () => {
  await withServer(async (baseUrl, token) => {
    // 1. Capture on existing job
    const job = await createJob(USER, {
      company: 'TechCorp',
      title: 'Automation Architect',
      jobUrl: 'https://jobs.lever.co/techcorp/112233',
      source: 'manual',
      descriptionText: 'Building internal tools.',
      status: 'shortlisted',
    });

    const captureRes1 = await fetch(`${baseUrl}/api/ext/applications`, {
      method: 'POST',
      headers: hdrs(token),
      body: JSON.stringify({
        jobId: job.id,
        atsName: 'lever',
        confirmationUrl: 'https://jobs.lever.co/techcorp/112233/thanks',
      }),
    });
    assert.equal(captureRes1.status, 200);
    const captureBody1 = (await captureRes1.json()) as { success: boolean; status: string; created: boolean; jobId: string };
    assert.equal(captureBody1.success, true);
    assert.equal(captureBody1.status, 'applied');
    assert.equal(captureBody1.created, false);

    const updatedJob = await getJobById(USER, job.id);
    assert.equal(updatedJob?.status, 'applied');
    assert.match(updatedJob?.notes || '', /Confirmation: https:\/\/jobs.lever.co\/techcorp\/112233\/thanks/);
    assert.match(updatedJob?.nextAction || '', /Follow up on application with TechCorp/);

    // 2. Capture on new job not previously tracked
    const captureRes2 = await fetch(`${baseUrl}/api/ext/applications`, {
      method: 'POST',
      headers: hdrs(token),
      body: JSON.stringify({
        company: 'Stripe',
        title: 'Backend Systems Engineer',
        jobUrl: 'https://boards.greenhouse.io/stripe/jobs/998877',
        atsName: 'greenhouse',
      }),
    });
    assert.equal(captureRes2.status, 201);
    const captureBody2 = (await captureRes2.json()) as { success: boolean; status: string; created: boolean; jobId: string };
    assert.equal(captureBody2.success, true);
    assert.equal(captureBody2.status, 'applied');
    assert.equal(captureBody2.created, true);
    assert.ok(captureBody2.jobId);

    const newJob = await getJobById(USER, captureBody2.jobId);
    assert.equal(newJob?.company, 'Stripe');
    assert.equal(newJob?.title, 'Backend Systems Engineer');
    assert.equal(newJob?.status, 'applied');
  });
});

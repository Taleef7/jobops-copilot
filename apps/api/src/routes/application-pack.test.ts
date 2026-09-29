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
import type { ApplicationPackPayload, ApplicationPackQuestionAnswer, CreateJobBody, StructuredResume } from '@/types';

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
  education: [{ institution: 'University of Washington', studyType: 'B.S.', area: 'Computer Science' }],
  skills: [{ category: 'Cloud & DevOps', skills: ['Kubernetes', 'Terraform', 'AWS', 'Go'] }],
};

const US_AUTH = 'Are you legally authorized to work in the United States?';
const US_SPONSOR = 'Will you now or in the future require visa sponsorship to work in the United States?';
const UK_AUTH = 'Are you legally authorized to work in the United Kingdom?';
const EXPECTED_SALARY = 'What are your salary expectations for this role?';

/** Runs `body` against a fresh file-backed store with the sample résumé on file. */
async function withFreshStores(body: () => Promise<void>) {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-app-pack-test-'));
  try {
    process.chdir(tempDir);
    resetJobStoreForTests();
    resetAgentOutputStoreForTests();
    await _resetApplicationAnswerStoreForTests([]);
    await resetResumeVersionStore();
    await upsertUserProfile(USER, { baseResume: sampleResume });
    await body();
  } finally {
    process.chdir(originalCwd);
    resetJobStoreForTests();
    resetAgentOutputStoreForTests();
    await _resetApplicationAnswerStoreForTests([]);
    await resetResumeVersionStore();
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function generatePack(jobBody: Omit<CreateJobBody, 'descriptionText'> & { descriptionText?: string }) {
  const job = await createJob(USER, { descriptionText: 'Backend engineering role.', ...jobBody });
  let result: { pack: ApplicationPackPayload; modelUsed: string; jobId: string } | undefined;
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/jobs/${job.id}/application-pack`, { method: 'POST', headers: hdrs(USER) });
    assert.equal(res.status, 201);
    const data = (await res.json()) as { applicationPack: ApplicationPackPayload; modelUsed: string };
    result = { pack: data.applicationPack, modelUsed: data.modelUsed, jobId: job.id };
  });
  return result!;
}

function byCategory(pack: ApplicationPackPayload, category: ApplicationPackQuestionAnswer['category']) {
  return pack.answers.filter((a) => a.category === category);
}

function assertNeedsAnswer(qa: ApplicationPackQuestionAnswer | undefined, label: string) {
  assert.ok(qa, `${label}: question missing`);
  assert.equal(qa.answer, '', `${label}: must be blank, got "${qa.answer}"`);
  assert.equal(qa.source, 'unanswerable', `${label}: source`);
  assert.equal(qa.flagged, true, `${label}: flagged`);
  assert.equal(qa.needsReview, true, `${label}: needsReview`);
}

test('a new account gets blank, flagged legal, salary and narrative answers; nothing is invented', async () => {
  await withFreshStores(async () => {
    const { pack, modelUsed } = await generatePack({
      company: 'Vaco LLC',
      title: 'Software Engineer',
      location: 'Austin, TX',
      salaryMin: 115991,
      salaryMax: 115991,
      descriptionText: 'Python, SQL and .NET.',
    });

    const [auth, sponsor] = byCategory(pack, 'work_authorization');
    assert.equal(auth?.questionText, US_AUTH);
    assert.equal(sponsor?.questionText, US_SPONSOR);
    assertNeedsAnswer(auth, 'work authorization');
    assertNeedsAnswer(sponsor, 'sponsorship');
    // The posted salary is not the user's expectation.
    assertNeedsAnswer(byCategory(pack, 'salary')[0], 'salary');
    // No template "why us" and no invented experience claim.
    assertNeedsAnswer(byCategory(pack, 'why_us')[0], 'why us');
    assertNeedsAnswer(byCategory(pack, 'behavioral')[0], 'experience');

    for (const qa of pack.answers) {
      assert.ok(!['profile', 'preferences', 'generated'].includes(qa.source), `unexpected source ${qa.source}`);
    }
    assert.deepEqual([...pack.flaggedQuestions].sort(), pack.answers.map((a) => a.questionText).sort());
    assert.equal(modelUsed, 'template');
    // The contact block still comes from the résumé the user entered.
    assert.equal(pack.contactBlock?.name, 'Alex Rivera');
    assert.equal(pack.contactBlock?.linkedin, 'https://linkedin.com/in/alexrivera');
  });
});

test('saved answers are used exactly as the user wrote them', async () => {
  await withFreshStores(async () => {
    await upsertApplicationAnswer(USER, { questionText: US_AUTH, answer: 'Yes' });
    await upsertApplicationAnswer(USER, { questionText: US_SPONSOR, answer: 'Yes, I will need H-1B sponsorship' });
    await upsertApplicationAnswer(USER, { questionText: EXPECTED_SALARY, answer: '$120,000 base' });

    const { pack } = await generatePack({ company: 'Stripe', title: 'Engineer', location: 'Seattle, WA' });
    const [auth, sponsor] = byCategory(pack, 'work_authorization');
    const salary = byCategory(pack, 'salary')[0];

    assert.equal(auth?.answer, 'Yes');
    assert.equal(sponsor?.answer, 'Yes, I will need H-1B sponsorship');
    assert.equal(salary?.answer, '$120,000 base');
    for (const qa of [auth, sponsor, salary]) {
      assert.equal(qa?.source, 'qa_memory');
      assert.equal(qa?.flagged, false);
      assert.equal(qa?.needsReview, false);
    }
    assert.ok(!pack.flaggedQuestions.includes(US_AUTH));
  });
});

test('a United States answer never answers a United Kingdom question', async () => {
  await withFreshStores(async () => {
    await upsertApplicationAnswer(USER, { questionText: US_AUTH, answer: 'Yes' });
    await upsertApplicationAnswer(USER, { questionText: US_SPONSOR, answer: 'No' });

    const { pack } = await generatePack({ company: 'Palantir', title: 'Backend Engineer', location: 'London, United Kingdom' });
    const [auth, sponsor] = byCategory(pack, 'work_authorization');
    assert.equal(auth?.questionText, UK_AUTH);
    assertNeedsAnswer(auth, 'UK authorization');
    assertNeedsAnswer(sponsor, 'UK sponsorship');
  });
});

test('with no readable country, a single saved country is offered for review, never silently', async () => {
  await withFreshStores(async () => {
    await upsertApplicationAnswer(USER, { questionText: US_AUTH, answer: 'Yes' });

    const { pack } = await generatePack({ company: 'Acme', title: 'Engineer', location: 'Remote' });
    const [auth, sponsor] = byCategory(pack, 'work_authorization');
    assert.match(auth?.questionText ?? '', /country where this role is based/);
    assert.equal(auth?.answer, 'Yes');
    assert.equal(auth?.source, 'qa_memory');
    assert.equal(auth?.flagged, true, 'a reused answer for an unknown country must be reviewed');
    assert.equal(auth?.needsReview, true);
    assert.match(auth?.note ?? '', /United States/);
    // Nothing was saved for sponsorship, so it stays blank.
    assertNeedsAnswer(sponsor, 'sponsorship');
  });
});

test('an answer confirmed for one countryless job is only offered for review on the next one', async () => {
  await withFreshStores(async () => {
    // The user confirmed "Yes" for a remote job whose country wasn't stated.
    await upsertApplicationAnswer(USER, {
      questionText: 'Are you legally authorized to work in the country where this role is based?',
      answer: 'Yes',
    });
    await upsertApplicationAnswer(USER, {
      questionText: 'Will you now or in the future require visa sponsorship to work in the country where this role is based?',
      answer: 'No',
    });

    const { pack } = await generatePack({ company: 'Other Co', title: 'Engineer', location: 'Remote' });
    for (const qa of byCategory(pack, 'work_authorization')) {
      assert.match(qa.questionText, /country where this role is based/);
      assert.equal(qa.source, 'qa_memory');
      assert.equal(qa.flagged, true, `${qa.questionText}: a countryless answer must never be reused silently`);
      assert.equal(qa.needsReview, true);
      assert.match(qa.note ?? '', /another role/);
      assert.ok(pack.flaggedQuestions.includes(qa.questionText));
    }
  });
});

test('a country-specific job never reuses a countryless answer', async () => {
  await withFreshStores(async () => {
    await upsertApplicationAnswer(USER, {
      questionText: 'Are you legally authorized to work in the country where this role is based?',
      answer: 'Yes',
    });
    const { pack } = await generatePack({ company: 'Palantir', title: 'Engineer', location: 'London, United Kingdom' });
    assertNeedsAnswer(byCategory(pack, 'work_authorization')[0], 'UK authorization');
  });
});

test('with no readable country and answers for two countries, nothing is reused', async () => {
  await withFreshStores(async () => {
    await upsertApplicationAnswer(USER, { questionText: US_AUTH, answer: 'Yes' });
    await upsertApplicationAnswer(USER, { questionText: UK_AUTH, answer: 'No' });

    const { pack } = await generatePack({ company: 'Acme', title: 'Engineer', location: 'Remote' });
    assertNeedsAnswer(byCategory(pack, 'work_authorization')[0], 'ambiguous authorization');
  });
});

test('a saved current salary never answers the expected-salary question', async () => {
  await withFreshStores(async () => {
    await upsertApplicationAnswer(USER, { questionText: 'What is your current salary?', answer: '$180,000' });
    const { pack } = await generatePack({ company: 'Acme', title: 'Engineer', location: 'Austin, TX' });
    assertNeedsAnswer(byCategory(pack, 'salary')[0], 'expected salary');
  });
});

test('GET serves the stored pack, and another user cannot read it', async () => {
  await withFreshStores(async () => {
    const job = await createJob(USER, {
      company: 'Stripe',
      title: 'Infrastructure Engineer',
      location: 'Seattle, WA',
      descriptionText: 'Scale core payment clusters.',
    });
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
      const before = await fetch(`${baseUrl}/api/jobs/${job.id}/application-pack`, { headers: hdrs(USER) });
      assert.equal(before.status, 404);

      const post = await fetch(`${baseUrl}/api/jobs/${job.id}/application-pack`, { method: 'POST', headers: hdrs(USER) });
      assert.equal(post.status, 201);
      const created = (await post.json()) as { applicationPack: ApplicationPackPayload };
      assert.equal(created.applicationPack.resumeVersionId, 'ver-tailored-1');
      assert.equal(created.applicationPack.resumeFileUrl, 'https://storage.blob.core.windows.net/resumes/stripe-tailored.pdf');

      const after = await fetch(`${baseUrl}/api/jobs/${job.id}/application-pack`, { headers: hdrs(USER) });
      assert.equal(after.status, 200);
      const stored = (await after.json()) as { applicationPack: ApplicationPackPayload; modelUsed: string };
      assert.equal(stored.applicationPack.jobId, job.id);
      assert.equal(stored.modelUsed, 'template');

      const other = await fetch(`${baseUrl}/api/jobs/${job.id}/application-pack`, { headers: hdrs('another_user') });
      assert.equal(other.status, 404);
    });
  });
});

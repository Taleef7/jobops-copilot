import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { jobsRouter } from './jobs';
import { createApp } from '@/app';
import { createJob, resetJobStoreForTests } from '@/data/job-store';
import { upsertUserProfile } from '@/data/profile-store';
import { getResumeVersion, insertResumeVersion, resetResumeVersionStore } from '@/data/resume-version-store';
import { closePool } from '@/lib/postgres';
import type { JobRecord, ResumeLayout, ResumeVersionRecord, StructuredResume } from '@/types';

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

// #346: re-adding a tracked posting, through any of its URLs, points at the existing job.
test('POST /api/jobs answers 409 with the existing job when the posting is already tracked', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-route-jobs-dup-'));

  try {
    process.chdir(tempDir);
    resetJobStoreForTests();

    await withServer((app) => app.use('/api/jobs', jobsRouter), async (baseUrl) => {
      const post = (userId: string, jobUrl: string) =>
        fetch(`${baseUrl}/api/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify({ company: 'Stripe', title: 'Engineer', descriptionText: 'Build payments.', jobUrl }),
        });

      const first = await post('test-user', 'https://job-boards.greenhouse.io/stripe/jobs/8172503');
      assert.equal(first.status, 201);
      const created = ((await first.json()) as { job: JobRecord }).job;

      const again = await post('test-user', 'https://stripe.com/jobs/search?gh_jid=8172503&utm_source=linkedin');
      assert.equal(again.status, 409);
      const body = (await again.json()) as {
        existingJobId?: string;
        existingJob?: { id: string; company: string; title: string };
        fields?: Record<string, string>;
      };
      assert.equal(body.existingJobId, created.id);
      assert.deepEqual(body.existingJob, { id: created.id, company: 'Stripe', title: 'Engineer' });
      assert.equal(body.fields?.jobUrl, 'You already added this job.');

      // Another user can track the same posting.
      assert.equal((await post('someone-else', 'https://stripe.com/jobs/search?gh_jid=8172503')).status, 201);
    });
  } finally {
    process.chdir(originalCwd);
    resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});

// #353: `/api/jobs/not-a-real-id` went to the database as is, and the routes whose SQL
// compares a uuid answered 500 for it (live took 12.5 s to show "not found"). A job id is a
// UUID, so anything else is a 404 before any lookup. The database here is unreachable: a
// route that queried would fail, not 404.
test('a malformed job id is a 404 on every /api/jobs/:id route, without a lookup', async () => {
  const savedUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:1/none';
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  const send = (method: string, path: string) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: { 'X-User-Id': 'u_bad_id', 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    });
  try {
    for (const [method, path] of [
      ['GET', '/api/jobs/not-a-real-id'],
      ['PATCH', '/api/jobs/not-a-real-id'],
      ['GET', '/api/jobs/not-a-real-id/agent-outputs'],
      ['GET', '/api/jobs/not-a-real-id/application-pack'],
      ['POST', '/api/jobs/not-a-real-id/application-pack'],
      ['GET', '/api/jobs/not-a-real-id/contacts'],
      ['POST', '/api/jobs/not-a-real-id/contacts'],
      ['POST', '/api/jobs/not-a-real-id/tailor'],
      ['GET', '/api/jobs/not-a-real-id/tailor/keywords'],
      ['GET', '/api/jobs/not-a-real-id/resume-versions'],
      ['GET', '/api/jobs/11111111-1111-4111-8111-11111111111/contacts'],
    ] as const) {
      const response = await send(method, path);
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.deepEqual(await response.json(), { error: 'Job not found' }, `${method} ${path}`);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
  }
});

// #412: a cleared field is sent as null and cleared; a field the request leaves out is unchanged.
test('PATCH /api/jobs/:id clears the notes, next action and follow-up sent as null, and keeps those left out', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL; // force in-memory/file store
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-route-jobs-'));

  try {
    process.chdir(tempDir);
    resetJobStoreForTests();

    await withServer((app) => app.use('/api/jobs', jobsRouter), async (baseUrl) => {
      const send = async (method: string, path: string, body: unknown) => {
        const response = await fetch(`${baseUrl}/api/jobs${path}`, {
          method,
          headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test-user' },
          body: JSON.stringify(body),
        });
        assert.ok(response.ok, `${method} ${path}: ${response.status}`);
        return ((await response.json()) as { job: JobRecord }).job;
      };
      const { id } = await send('POST', '', { company: 'Acme', title: 'Engineer', descriptionText: 'Go.' });
      const filled = { notes: 'Call Sam', nextAction: 'Send the follow-up', nextActionDue: '2026-10-20T13:00:00.000Z' };
      await send('PATCH', `/${id}`, filled);

      const kept = await send('PATCH', `/${id}`, { priority: 'high' });
      assert.deepEqual(
        { notes: kept.notes, nextAction: kept.nextAction, nextActionDue: kept.nextActionDue },
        filled,
      );

      const cleared = await send('PATCH', `/${id}`, { notes: null, nextAction: null, nextActionDue: null });
      assert.equal(cleared.notes, undefined);
      assert.equal(cleared.nextAction || undefined, undefined);
      assert.equal(cleared.nextActionDue, undefined);
    });
  } finally {
    process.chdir(originalCwd);
    resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});

// #415: a tailored draft follows the base résumé's layout until it's downloaded or its job is
// marked applied. Marking the job applied freezes the layout on its drafts, once.
test("marking a job applied freezes the base résumé's layout on its drafts", async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-route-jobs-applied-'));
  const user = 'user-applied';
  const atTailoring: ResumeLayout = { sections: [{ key: 'skills' }] };
  const whenApplied: ResumeLayout = { sections: [{ key: 'education', title: 'Schooling' }] };
  const later: ResumeLayout = { sections: [{ key: 'work', hidden: true }] };
  const resume: StructuredResume = {
    basics: { name: 'Jordan Lee', email: 'jordan@example.com', summary: 'Engineer.' },
    work: [],
    education: [],
    skills: [],
  };

  try {
    process.chdir(tempDir);
    resetJobStoreForTests();
    await resetResumeVersionStore();
    const job = await createJob(user, { company: 'Acme Pay', title: 'Backend Engineer', descriptionText: 'Build payment APIs.' });
    await upsertUserProfile(user, { baseResume: { ...resume, layout: whenApplied } });
    const now = new Date().toISOString();
    const version = (id: string, overrides: Partial<ResumeVersionRecord> = {}): ResumeVersionRecord => ({
      id,
      userId: user,
      jobId: job.id,
      changeSummary: 'Tailored',
      structuredResume: { ...resume, layout: atTailoring },
      approved: false,
      isBase: false,
      basedOn: { baseVersionId: null, baseUpdatedAt: null, jobId: job.id, postingSha256: 'x', model: 'm', createdAt: now, grounding: { version: 1 } },
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
    await insertResumeVersion(version('draft'));
    await insertResumeVersion(version('downloaded', { approved: true }));
    await insertResumeVersion(version('other-job', { jobId: 'another-job' }));

    await withServer((app) => app.use('/api/jobs', jobsRouter), async (baseUrl) => {
      const patch = (body: unknown) =>
        fetch(`${baseUrl}/api/jobs/${job.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': user },
          body: JSON.stringify(body),
        });

      // Any other status, or a note, freezes nothing.
      assert.equal((await patch({ status: 'shortlisted' })).status, 200);
      assert.deepEqual((await getResumeVersion(user, 'draft'))!.structuredResume.layout, atTailoring);

      assert.equal((await patch({ status: 'applied' })).status, 200);
      const frozen = (await getResumeVersion(user, 'draft'))!;
      assert.deepEqual(frozen.structuredResume.layout, whenApplied);
      assert.ok(frozen.basedOn?.layoutFrozenAt);
      // A downloaded version, and another job's draft, are left alone.
      assert.deepEqual((await getResumeVersion(user, 'downloaded'))!.structuredResume.layout, atTailoring);
      assert.equal((await getResumeVersion(user, 'downloaded'))!.basedOn?.layoutFrozenAt, undefined);
      assert.deepEqual((await getResumeVersion(user, 'other-job'))!.structuredResume.layout, atTailoring);

      // Saved again as applied (the edit panel sends the status with every save): no change.
      await upsertUserProfile(user, { baseResume: { ...resume, layout: later } });
      assert.equal((await patch({ status: 'applied', notes: 'Followed up.' })).status, 200);
      assert.deepEqual(await getResumeVersion(user, 'draft'), frozen);
    });
  } finally {
    process.chdir(originalCwd);
    resetJobStoreForTests();
    await resetResumeVersionStore();
    await rm(tempDir, { recursive: true, force: true });
  }
});

// The owner's rule: drafts follow the base layout "until downloaded or applied". A job moved
// straight past applied (to an interview, an offer, a rejection) was applied to as well.
test('moving a job straight to a stage after applied freezes its drafts too; outreach or archiving does not', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-route-jobs-stages-'));
  const user = 'user-stages';
  const layout: ResumeLayout = { sections: [{ key: 'education', title: 'Schooling' }] };
  const resume: StructuredResume = { basics: { name: 'Jordan Lee', email: '', summary: 'Engineer.' }, work: [], education: [], skills: [] };

  try {
    process.chdir(tempDir);
    resetJobStoreForTests();
    await resetResumeVersionStore();
    await upsertUserProfile(user, { baseResume: { ...resume, layout } });
    const now = new Date().toISOString();

    await withServer((app) => app.use('/api/jobs', jobsRouter), async (baseUrl) => {
      const moveTo = async (from: string, to: string) => {
        const job = await createJob(user, { company: `Acme ${from} ${to}`, title: 'Engineer', descriptionText: 'Go.' });
        const id = `draft-${from}-${to}`;
        await insertResumeVersion({
          id,
          userId: user,
          jobId: job.id,
          changeSummary: 'Tailored',
          structuredResume: resume,
          approved: false,
          isBase: false,
          basedOn: { baseVersionId: null, baseUpdatedAt: null, jobId: job.id, postingSha256: 'x', model: 'm', createdAt: now, grounding: { version: 1 } },
          createdAt: now,
          updatedAt: now,
        });
        const patch = (status: string) =>
          fetch(`${baseUrl}/api/jobs/${job.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-User-Id': user },
            body: JSON.stringify({ status }),
          });
        assert.equal((await patch(from)).status, 200);
        assert.equal((await patch(to)).status, 200);
        return Boolean((await getResumeVersion(user, id))!.basedOn?.layoutFrozenAt);
      };

      for (const stage of ['interview', 'offer', 'rejected', 'follow_up_due']) {
        assert.equal(await moveTo('shortlisted', stage), true, `shortlisted → ${stage} freezes`);
      }
      for (const stage of ['outreach_sent', 'referral_requested', 'archived']) {
        assert.equal(await moveTo('shortlisted', stage), false, `shortlisted → ${stage} doesn't`);
      }
    });
  } finally {
    process.chdir(originalCwd);
    resetJobStoreForTests();
    await resetResumeVersionStore();
    await rm(tempDir, { recursive: true, force: true });
  }
});

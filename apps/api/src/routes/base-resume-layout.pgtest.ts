import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { baseResumeRouter } from './base-resume';
import { freezeDraftLayouts } from '@/data/base-resume';
import { createJob } from '@/data/job-store';
import { getUserProfile, upsertUserProfile } from '@/data/profile-store';
import { getBaseResumeVersion, getResumeVersion, insertResumeVersion, listResumeVersionsForUser } from '@/data/resume-version-store';
import { getPool } from '@/lib/postgres';
import type { ResumeLayout, StructuredResume } from '@/types';

// Runs only against a real, ephemeral Postgres (the `db` CI job). The base résumé's layout
// (#415) in Postgres: saved to both copies, kept by a résumé save, frozen onto a job's drafts,
// and a PDF preview that writes no row.
const DB = process.env.DATABASE_URL?.trim();
const skip = DB ? false : 'DATABASE_URL not set — Postgres integration test skipped';

const resume: StructuredResume = {
  basics: { name: 'Jordan Lee', email: 'jordan@example.com', summary: 'Engineer.' },
  work: [{ company: 'Globex', position: 'Engineer', startDate: '2022-01', highlights: ['Built the billing API'] }],
  education: [],
  skills: [{ category: 'Languages', skills: ['Go'] }],
};
const LAYOUT: ResumeLayout = { sections: [{ key: 'skills', title: 'Technical Skills' }, { key: 'summary', hidden: true }], pageSize: 'a4' };

async function withApi(userId: string, run: (send: (method: string, path: string, body?: unknown) => Promise<Response>) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.userId = userId;
    next();
  });
  app.use('/api/profile/base-resume', baseResumeRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  try {
    await run((method, path, body) =>
      fetch(`http://127.0.0.1:${port}/api/profile/base-resume${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('the layout is saved to both copies, kept by a résumé save, and the preview writes no row', { skip }, async () => {
  const userId = `itest_layout_${randomUUID().slice(0, 8)}`;
  await withApi(userId, async (send) => {
    assert.equal((await send('PATCH', '/layout', LAYOUT)).status, 404, 'no résumé yet');
    assert.equal((await send('PUT', '', { baseResume: resume })).status, 200);
    assert.equal((await send('PATCH', '/layout', LAYOUT)).status, 200);
    assert.deepEqual((await getUserProfile(userId))?.baseResume?.layout, LAYOUT);
    assert.deepEqual((await getBaseResumeVersion(userId))?.structuredResume.layout, LAYOUT);

    // A save from Settings, and a replacement read from a file: the layout stays.
    assert.equal((await send('PUT', '', { baseResume: { ...resume, basics: { ...resume.basics, summary: 'Edited.' } } })).status, 200);
    assert.equal((await send('PUT', '', { baseResume: resume, resumeText: 'Jordan Lee', resumeFileName: 'new.pdf' })).status, 200);
    const profile = await getUserProfile(userId);
    assert.deepEqual(profile?.baseResume?.layout, LAYOUT);
    assert.equal(profile?.resumeFileName, 'new.pdf');
    assert.deepEqual((await getBaseResumeVersion(userId))?.structuredResume.layout, LAYOUT);

    const rows = async () =>
      (await getPool()!.query<{ n: string }>('select count(*) as n from resume_versions where user_id = $1', [userId])).rows[0]!.n;
    const before = await rows();
    const pdf = await send('GET', '/pdf');
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('x-page-count'), '1');
    assert.equal(await rows(), before);
    assert.equal((await listResumeVersionsForUser(userId)).length, 1);
  });
});

test("marking a job applied freezes the base layout on its drafts, in Postgres", { skip }, async () => {
  const userId = `itest_freeze_${randomUUID().slice(0, 8)}`;
  // resume_versions.job_id references jobs.
  const jobId = (await createJob(userId, { company: 'Acme Pay', title: 'Backend Engineer', descriptionText: 'Build payment APIs.' })).id;
  await upsertUserProfile(userId, { baseResume: { ...resume, layout: LAYOUT } });
  const now = new Date().toISOString();
  const draft = {
    id: randomUUID(),
    userId,
    jobId,
    changeSummary: 'Tailored',
    structuredResume: resume,
    approved: false,
    isBase: false,
    basedOn: { baseVersionId: null, baseUpdatedAt: null, jobId, postingSha256: 'x', model: 'm', createdAt: now, grounding: { version: 1 } },
    createdAt: now,
    updatedAt: now,
  };
  await insertResumeVersion(draft);
  await insertResumeVersion({ ...draft, id: randomUUID(), approved: true });

  assert.equal(await freezeDraftLayouts(userId, jobId), 1);
  const frozen = (await getResumeVersion(userId, draft.id))!;
  assert.deepEqual(frozen.structuredResume.layout, LAYOUT);
  assert.ok(frozen.basedOn?.layoutFrozenAt);
  // Once frozen, it stays as it is.
  await upsertUserProfile(userId, { baseResume: resume });
  assert.equal(await freezeDraftLayouts(userId, jobId), 0);
  assert.deepEqual((await getResumeVersion(userId, draft.id))!.structuredResume.layout, LAYOUT);
});

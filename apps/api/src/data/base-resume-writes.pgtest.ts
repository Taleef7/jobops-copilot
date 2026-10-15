import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { changeBaseResume, getUserProfile, upsertUserProfile } from './profile-store';
import { getBaseResumeVersion, insertResumeVersion } from './resume-version-store';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { getPool } from '@/lib/postgres';
import { baseResumeRouter } from '@/routes/base-resume';
import type { StructuredResume } from '@/types';

// The base résumé has two copies: the profile's, which Settings shows, and the base version's,
// which the résumé studio, application pack and outreach read first (#408). A write that fails
// part-way must change neither. Runs only against a real, ephemeral Postgres (the `db` CI job).
const DB = process.env.DATABASE_URL?.trim();
const skip = DB ? false : 'DATABASE_URL not set — Postgres integration test skipped';

const newUser = () => `itest_408_${randomUUID().slice(0, 8)}`;

const resume = (summary: string): StructuredResume => ({
  basics: { name: 'Jordan Lee', email: 'jordan@example.com', summary },
  work: [],
  education: [],
  skills: [{ category: 'Languages', skills: ['Go'] }],
});

/** While `run` runs, every write to this user's résumé versions fails, as a dropped connection would. */
async function withFailingVersionWrites(userId: string, run: () => Promise<void>) {
  const pool = getPool();
  assert.ok(pool, 'DATABASE_URL is set but there is no pool');
  const name = `itest_fail_${randomUUID().slice(0, 8)}`;
  await pool.query(`create function ${name}() returns trigger language plpgsql as $$ begin raise exception 'version write failed'; end $$`);
  await pool.query(
    `create trigger ${name} before insert or update on resume_versions for each row when (new.user_id = '${userId}') execute function ${name}()`,
  );
  try {
    await run();
  } finally {
    await pool.query(`drop trigger ${name} on resume_versions`);
    await pool.query(`drop function ${name}()`);
  }
}

async function putBaseResume(userId: string, body: unknown): Promise<number> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.userId = userId;
    next();
  });
  app.use('/api/profile/base-resume', baseResumeRouter);
  app.use(apiErrorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no server address');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/profile/base-resume`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.status;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('a save whose version write fails changes neither copy', { skip }, async () => {
  const userId = newUser();
  assert.equal(await putBaseResume(userId, { baseResume: resume('Old.'), resumeText: 'old text', resumeFileName: 'old.pdf' }), 200);
  const profile = await getUserProfile(userId);
  const version = await getBaseResumeVersion(userId);
  assert.equal(version?.structuredResume.basics.summary, 'Old.');

  // A replacement file: its résumé and its text.
  await withFailingVersionWrites(userId, async () => {
    const status = await putBaseResume(userId, { baseResume: resume('New.'), resumeText: 'new text', resumeFileName: 'new.pdf' });
    assert.equal(status, 500);
  });

  const after = await getUserProfile(userId);
  assert.equal(after?.baseResume?.basics.summary, 'Old.');
  assert.equal(after?.resumeText, 'old text');
  assert.equal(after?.resumeFileName, 'old.pdf');
  assert.deepEqual(after, profile);
  assert.deepEqual(await getBaseResumeVersion(userId), version);

  // Saved again once the database is back: both copies.
  assert.equal(await putBaseResume(userId, { baseResume: resume('New.'), resumeText: 'new text', resumeFileName: 'new.pdf' }), 200);
  assert.equal((await getUserProfile(userId))?.resumeText, 'new text');
  assert.equal((await getUserProfile(userId))?.baseResume?.basics.summary, 'New.');
  assert.equal((await getBaseResumeVersion(userId))?.structuredResume.basics.summary, 'New.');
});

test('a first save whose version write fails leaves no profile behind', { skip }, async () => {
  const userId = newUser();
  await withFailingVersionWrites(userId, async () => {
    assert.equal(await putBaseResume(userId, { baseResume: resume('First.'), resumeText: 'text', resumeFileName: 'cv.pdf' }), 500);
  });
  assert.equal(await getUserProfile(userId), undefined);
  assert.equal(await getBaseResumeVersion(userId), null);
});

test("keywords added to the base résumé from tailoring go on both copies, or neither", { skip }, async () => {
  const userId = newUser();
  const now = new Date().toISOString();
  await upsertUserProfile(userId, { baseResume: resume('Base.'), resumeText: 'text' });
  await insertResumeVersion({
    id: randomUUID(),
    userId,
    jobId: null,
    changeSummary: 'Initial base resume created',
    structuredResume: resume('Base.'),
    approved: true,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  const add = (skill: string) => (base: StructuredResume) => ({ ...base, skills: [...base.skills, { category: skill, skills: [skill] }] });

  await changeBaseResume(userId, null, add('Kafka'));
  assert.deepEqual((await getUserProfile(userId))?.baseResume?.skills.map((g) => g.category), ['Languages', 'Kafka']);
  assert.deepEqual((await getBaseResumeVersion(userId))?.structuredResume.skills.map((g) => g.category), ['Languages', 'Kafka']);

  const profile = await getUserProfile(userId);
  const version = await getBaseResumeVersion(userId);
  await withFailingVersionWrites(userId, async () => {
    await assert.rejects(changeBaseResume(userId, null, add('Redis')), /version write failed/);
  });
  assert.deepEqual(await getUserProfile(userId), profile);
  assert.deepEqual(await getBaseResumeVersion(userId), version);
});

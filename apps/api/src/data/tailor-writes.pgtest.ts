import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { changeBaseResume, getUserProfile, upsertUserProfile } from './profile-store';
import { getResumeVersion, insertResumeVersion, updateResumeVersion } from './resume-version-store';
import type { StructuredResume } from '@/types';

// Runs only against a real, ephemeral Postgres (the `db` CI job). The tailor review's writes
// (#351): a draft changes only while it is as it was read, and confirmed keywords go on the base
// résumé as it is at that moment.
const DB = process.env.DATABASE_URL?.trim();
const skip = DB ? false : 'DATABASE_URL not set — Postgres integration test skipped';

const resume: StructuredResume = {
  basics: { name: 'Jordan Lee', email: 'jordan@example.com', summary: 'Engineer.' },
  work: [],
  education: [],
  skills: [{ category: 'Languages', skills: ['Go'] }],
};

test('a draft changes only while it is as it was read', { skip }, async () => {
  const userId = `itest_cond_${randomUUID().slice(0, 8)}`;
  const id = randomUUID();
  const now = new Date().toISOString();
  await insertResumeVersion({
    id,
    userId,
    jobId: null,
    changeSummary: 'Tailored',
    structuredResume: resume,
    approved: false,
    isBase: false,
    // A tailored version carries the grounding marker (migration 029).
    basedOn: { baseVersionId: null, baseUpdatedAt: null, jobId: 'job-1', postingSha256: 'a'.repeat(64), model: 'm', createdAt: now, grounding: { version: 1 } },
    createdAt: now,
    updatedAt: now,
  });
  const read = (await getResumeVersion(userId, id))!;
  const first = await updateResumeVersion(userId, id, { changeSummary: 'First' }, { expect: { updatedAt: read.updatedAt, approved: false } });
  assert.equal(first?.changeSummary, 'First');
  assert.equal(await updateResumeVersion(userId, id, { changeSummary: 'Stale' }, { expect: { updatedAt: read.updatedAt } }), null);
  const approved = (await updateResumeVersion(userId, id, { approved: true }, { expect: { updatedAt: first!.updatedAt } }))!;
  assert.equal(approved.approved, true);
  assert.equal(
    await updateResumeVersion(userId, id, { changeSummary: 'After download' }, { expect: { updatedAt: approved.updatedAt, approved: false } }),
    null,
  );
  assert.equal((await getResumeVersion(userId, id))!.changeSummary, 'First');
});

test("each write moves a draft's updatedAt on by at least a millisecond", { skip }, async () => {
  // A stale read must never match after a write, even one in the same millisecond, or the
  // clock behind: here the row's time is ahead of now().
  const userId = `itest_tick_${randomUUID().slice(0, 8)}`;
  const id = randomUUID();
  const ahead = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await insertResumeVersion({
    id,
    userId,
    jobId: null,
    changeSummary: 'Tailored',
    structuredResume: resume,
    approved: false,
    isBase: false,
    // A tailored version carries the grounding marker (migration 029).
    basedOn: { baseVersionId: null, baseUpdatedAt: null, jobId: 'job-1', postingSha256: 'a'.repeat(64), model: 'm', createdAt: ahead, grounding: { version: 1 } },
    createdAt: ahead,
    updatedAt: ahead,
  });
  const first = (await updateResumeVersion(userId, id, { changeSummary: 'First' }, { expect: { updatedAt: ahead } }))!;
  assert.ok(Date.parse(first.updatedAt) > Date.parse(ahead), `${first.updatedAt} should be after ${ahead}`);
  const second = (await updateResumeVersion(userId, id, { changeSummary: 'Second' }))!;
  assert.ok(Date.parse(second.updatedAt) > Date.parse(first.updatedAt));
  assert.equal(await updateResumeVersion(userId, id, { changeSummary: 'Stale' }, { expect: { updatedAt: first.updatedAt } }), null);
});

test('confirmed keywords from runs at once all go on the latest base résumé', { skip }, async () => {
  const userId = `itest_base_${randomUUID().slice(0, 8)}`;
  await upsertUserProfile(userId, { baseResume: resume, resumeText: 'text' });
  const add = (skill: string) => (base: StructuredResume) => ({ ...base, skills: [...base.skills, { category: skill, skills: [skill] }] });
  await Promise.all(['Kafka', 'Snowflake', 'Redis', 'dbt'].map((skill) => changeBaseResume(userId, null, add(skill))));
  const saved = await getUserProfile(userId);
  assert.deepEqual(saved?.baseResume?.skills.map((g) => g.category).sort(), ['Kafka', 'Languages', 'Redis', 'Snowflake', 'dbt']);
  assert.equal(saved?.resumeText, 'text');
  assert.equal(await changeBaseResume(userId, null, () => null), null);

  const fresh = `itest_base_${randomUUID().slice(0, 8)}`;
  const changed = await changeBaseResume(fresh, resume, (base) => ({ ...base, basics: { ...base.basics, summary: 'Changed.' } }));
  assert.equal(changed?.basics.summary, 'Changed.');
  assert.equal((await getUserProfile(fresh))?.baseResume?.basics.summary, 'Changed.');
});

test('runs at once for a user with no profile row yet all land too', { skip }, async () => {
  // A base version but no profile row (the base PDF route can make one): every run starts from
  // the base version's copy.
  const userId = `itest_norow_${randomUUID().slice(0, 8)}`;
  const add = (skill: string) => (base: StructuredResume) => ({ ...base, skills: [...base.skills, { category: skill, skills: [skill] }] });
  await Promise.all(['Kafka', 'Snowflake', 'Redis', 'dbt'].map((skill) => changeBaseResume(userId, resume, add(skill))));
  const saved = await getUserProfile(userId);
  assert.deepEqual(saved?.baseResume?.skills.map((g) => g.category).sort(), ['Kafka', 'Languages', 'Redis', 'Snowflake', 'dbt']);
  // Nothing to change: no row is left behind.
  const none = `itest_norow_${randomUUID().slice(0, 8)}`;
  assert.equal(await changeBaseResume(none, resume, () => null), null);
  assert.equal(await getUserProfile(none), undefined);
});

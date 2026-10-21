import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { getPool } from '@/lib/postgres';
import type { CoverLetterRecord } from '@/types';
import { deleteCoverLetters, getCoverLetter, saveCoverLetter, updateCoverLetter } from './cover-letter-store';
import { appendOutreachDraft, clearUserData, createJob, getJobById } from './job-store';

// Runs only against a real, ephemeral Postgres (the `db` CI job). The cover letter (#416): one
// per job and user, changed only while it is as it was read, and untouched by outreach drafts,
// which replace the job's unsent drafts.
const DB = process.env.DATABASE_URL?.trim();
const skip = DB ? false : 'DATABASE_URL not set — Postgres integration test skipped';

function letterFor(userId: string, jobId: string, text: string, length: CoverLetterRecord['length'] = 'concise'): CoverLetterRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId,
    jobId,
    length,
    paragraphs: [
      { text, edited: false },
      { text: 'Thank you for your time.', edited: false },
    ],
    checks: [{ id: 'c0', paragraph: null, text: 'I ran Kafka.', dropped: true, severity: 'drop', dropReason: 'adds Kafka', issues: [{ code: 'NEW_SKILL', term: 'Kafka', message: 'adds Kafka', severity: 'drop' }] }],
    basedOn: {
      baseVersionId: null,
      baseUpdatedAt: now,
      jobId,
      postingSha256: 'a'.repeat(64),
      model: 'openai:gpt-6-luna',
      createdAt: now,
      grounding: { version: 1 },
      confirmedKeywords: ['Kafka'],
    },
    createdAt: now,
    updatedAt: now,
  };
}

test('one letter per job: a second save replaces the first; each user sees only their own', { skip }, async () => {
  const user = `itest_letter_${randomUUID().slice(0, 8)}`;
  const job = await createJob(user, { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs.' });
  const other = await createJob(user, { company: 'Globex', title: 'Engineer', descriptionText: 'Build APIs.' });

  const first = await saveCoverLetter(letterFor(user, job.id, 'First letter.'));
  assert.equal(first.paragraphs[0]!.text, 'First letter.');
  assert.deepEqual(first.checks[0]!.issues[0]!.code, 'NEW_SKILL');
  assert.deepEqual(first.basedOn.confirmedKeywords, ['Kafka']);
  const second = await saveCoverLetter(letterFor(user, job.id, 'Second letter.', 'full'));
  assert.equal(second.length, 'full');
  await saveCoverLetter(letterFor(user, other.id, 'Another job.'));

  const { rows } = await getPool()!.query('select count(*)::int as n from cover_letters where user_id = $1 and job_id = $2', [user, job.id]);
  assert.equal(rows[0].n, 1);
  assert.equal((await getCoverLetter(user, job.id))!.paragraphs[0]!.text, 'Second letter.');
  assert.equal((await getCoverLetter(user, other.id))!.paragraphs[0]!.text, 'Another job.');
  assert.equal(await getCoverLetter(`${user}_intruder`, job.id), null);
});

test('a letter changes only while it is as it was read', { skip }, async () => {
  const user = `itest_letter_cond_${randomUUID().slice(0, 8)}`;
  const job = await createJob(user, { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs.' });
  const saved = await saveCoverLetter(letterFor(user, job.id, 'First letter.'));
  const paragraphs = [{ text: 'My own words.', edited: true }, saved.paragraphs[1]!];

  const edited = await updateCoverLetter(user, job.id, { paragraphs, checks: [] }, { expect: { updatedAt: saved.updatedAt } });
  assert.deepEqual(edited!.paragraphs, paragraphs);
  assert.deepEqual(edited!.checks, []);
  assert.ok(edited!.updatedAt > saved.updatedAt);
  assert.equal(await updateCoverLetter(user, job.id, { paragraphs: saved.paragraphs }, { expect: { updatedAt: saved.updatedAt } }), null);
  assert.equal(await updateCoverLetter(`${user}_intruder`, job.id, { paragraphs: saved.paragraphs }), null);
  assert.deepEqual((await getCoverLetter(user, job.id))!.paragraphs, paragraphs);
});

test("outreach drafts for the job don't delete its letter; deleting the job or the user's data does", { skip }, async () => {
  const user = `itest_letter_outreach_${randomUUID().slice(0, 8)}`;
  const job = await createJob(user, { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs.' });
  await saveCoverLetter(letterFor(user, job.id, 'Keep me.'));
  for (let i = 0; i < 2; i += 1) {
    await appendOutreachDraft(user, job.id, {
      id: randomUUID(),
      jobId: job.id,
      messageType: 'recruiter_email',
      draftText: `Hello ${i}`,
      status: 'drafted',
      createdAt: new Date().toISOString(),
    });
  }
  assert.equal((await getJobById(user, job.id))!.outreach.length, 1, 'the second draft replaced the first');
  assert.equal((await getCoverLetter(user, job.id))!.paragraphs[0]!.text, 'Keep me.');

  // The job's own delete cascades; so does clearing the user's data.
  await getPool()!.query('delete from jobs where id = $1', [job.id]);
  assert.equal(await getCoverLetter(user, job.id), null);
  const again = await createJob(user, { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs.' });
  await saveCoverLetter(letterFor(user, again.id, 'Me too.'));
  await clearUserData(user);
  assert.equal(await getCoverLetter(user, again.id), null);

  const last = await createJob(user, { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs.' });
  await saveCoverLetter(letterFor(user, last.id, 'And me.'));
  await deleteCoverLetters(user);
  assert.equal(await getCoverLetter(user, last.id), null);
});

test('the table takes only a Concise or Full letter, with an owner', { skip }, async () => {
  const user = `itest_letter_check_${randomUUID().slice(0, 8)}`;
  const job = await createJob(user, { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs.' });
  await assert.rejects(saveCoverLetter({ ...letterFor(user, job.id, 'x'), length: 'long' as 'full' }));
  await assert.rejects(
    getPool()!.query(
      "insert into cover_letters (id, user_id, job_id, length, paragraphs, checks, based_on) values ($1, null, $2, 'full', '[]', '[]', '{}')",
      [randomUUID(), job.id],
    ),
  );
});

test("the database itself refuses another length, and a letter for someone else's job", { skip }, async () => {
  const user = `itest_letter_db_${randomUUID().slice(0, 8)}`;
  const job = await createJob(user, { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs.' });
  const insert = (owner: string, length: string) =>
    getPool()!.query(
      "insert into cover_letters (id, user_id, job_id, length, paragraphs, checks, based_on) values ($1, $2, $3, $4, '[]', '[]', '{}')",
      [randomUUID(), owner, job.id, length],
    );
  // Past the JS guard: the CHECK constraint.
  await assert.rejects(insert(user, 'long'), /cover_letters_length_check/);
  // The job belongs to `user`: a row for another owner breaks the (job_id, user_id) foreign key.
  await assert.rejects(insert(`${user}_intruder`, 'full'), /foreign key/);
  await insert(user, 'full');
});

test('migration 031 can run again over itself', { skip }, async () => {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { findMigrationDir } = await import('@/lib/migrations');
  const sql = await readFile(join(findMigrationDir(__dirname)!, '031_cover_letters.sql'), 'utf8');
  await getPool()!.query(sql);
  await getPool()!.query(sql);
  const { rows } = await getPool()!.query("select 1 from pg_indexes where indexname = 'jobs_id_user_id_key'");
  assert.equal(rows.length, 1, 'the unique index the foreign key needs');
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { getJobById, createJob, saveJobAnalysis, updateJob } from './job-store';
import { ANALYZED_NEXT_ACTION, UNSCORED_NEXT_ACTION } from '@/lib/analysis-workflow';
import { findMigrationDir } from '@/lib/migrations';
import { getPool } from '@/lib/postgres';
import { sampleAnalysis } from '@/test-support/analysis';

// Runs only against a real, ephemeral Postgres (the `db` CI job). Migration 027 deletes the
// made-up analyses the keyword fallbacks saved as the AI's (#349), and clears the fit score
// they carried, but keeps real scores, the labelled discovery pre-rank, and the user's notes.
const DB = process.env.DATABASE_URL?.trim();

test(
  'migration 027 deletes only the made-up analyses and their scores',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async () => {
    const pool = getPool();
    assert.ok(pool);
    const userId = `itest_027_${randomUUID().slice(0, 8)}`;
    const add = (title: string) => createJob(userId, { company: 'Acme', title, descriptionText: 'Go and Postgres.' });

    const fake = await add('Fake analysis');
    await saveJobAnalysis(userId, fake.id, sampleAnalysis({ modelUsed: 'mock-analysis-v1' }), 60);
    const real = await add('Real score');
    await saveJobAnalysis(userId, real.id, sampleAnalysis({ modelUsed: 'openai:gpt-5.4-nano' }), 70);
    const prerank = await add('Discovery estimate');
    await saveJobAnalysis(userId, prerank.id, sampleAnalysis({ modelUsed: 'local-prerank', confidenceScore: null }), 40);
    const fakeWithNote = await add('Fake score, own note');
    await saveJobAnalysis(userId, fakeWithNote.id, sampleAnalysis({ modelUsed: 'mock-fit-scorer-v1' }), 55);
    await updateJob(userId, fakeWithNote.id, { nextAction: 'Call Sam on Monday' });
    assert.equal((await getJobById(userId, fake.id))?.nextAction, ANALYZED_NEXT_ACTION);

    const dir = findMigrationDir(__dirname);
    assert.ok(dir, 'db/migrations not found');
    await pool.query(await readFile(join(dir, '027_delete_mock_analyses.sql'), 'utf8'));

    const after = async (id: string) => {
      const job = await getJobById(userId, id);
      return { model: job?.analysis?.modelUsed ?? null, fitScore: job?.fitScore ?? null, nextAction: job?.nextAction };
    };
    assert.deepEqual(await after(fake.id), { model: null, fitScore: null, nextAction: UNSCORED_NEXT_ACTION });
    assert.deepEqual(await after(real.id), { model: 'openai:gpt-5.4-nano', fitScore: 70, nextAction: ANALYZED_NEXT_ACTION });
    assert.equal((await after(prerank.id)).model, 'local-prerank');
    assert.equal((await after(prerank.id)).fitScore, 40);
    assert.deepEqual(await after(fakeWithNote.id), { model: null, fitScore: null, nextAction: 'Call Sam on Monday' });

    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from job_analysis where model_used like 'mock-%'",
    );
    assert.equal(rows[0]?.n, 0);
  },
);

test(
  'a new job gets no analysis row until a real score',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async () => {
    const pool = getPool();
    assert.ok(pool);
    const userId = `itest_349_${randomUUID().slice(0, 8)}`;
    const job = await createJob(userId, { company: 'Acme', title: 'Engineer', descriptionText: 'Python and Docker.' });

    const { rows } = await pool.query<{ n: number }>('select count(*)::int as n from job_analysis where job_id = $1', [job.id]);
    assert.equal(rows[0]?.n, 0);
    assert.equal(job.analysis, null);
    assert.equal(job.fitScore, null);
  },
);

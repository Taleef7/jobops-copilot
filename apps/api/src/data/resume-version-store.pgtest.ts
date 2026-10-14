import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createJob } from './job-store';
import { getResumeVersion, insertResumeVersion } from './resume-version-store';
import { findMigrationDir } from '@/lib/migrations';
import { getPool } from '@/lib/postgres';
import type { StructuredResume } from '@/types';

// Runs only against a real, ephemeral Postgres (the `db` CI job). Migration 028 (#351) gives
// every résumé version an owner (from its job, else it's removed: no user could see it) and
// adds `based_on`, what a tailored version was based on.
const DB = process.env.DATABASE_URL?.trim();

const resume: StructuredResume = {
  basics: { name: 'Jordan Lee', email: 'jordan@example.com', summary: 'Analyst.' },
  work: [],
  education: [],
  skills: [],
};

test(
  'migration 028 gives every version an owner and adds based_on',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async () => {
    const pool = getPool();
    assert.ok(pool);
    const userId = `itest_028_${randomUUID().slice(0, 8)}`;
    const job = await createJob(userId, { company: 'Acme', title: 'Analyst', descriptionText: 'SQL.' });
    const dir = findMigrationDir(__dirname);
    assert.ok(dir, 'db/migrations not found');
    const sql = await readFile(join(dir, '028_resume_versions_owner_and_basis.sql'), 'utf8');

    const client = await pool.connect();
    try {
      await client.query('begin');
      // Put the table back as it was before 028, inside this transaction only.
      await client.query('alter table resume_versions alter column user_id drop not null');
      const insert = (id: string, owner: string | null, jobId: string | null, isBase: boolean) =>
        client.query(
          `insert into resume_versions (id, user_id, job_id, change_summary, structured_resume, approved, is_base)
           values ($1, $2, $3, 'x', $4, false, $5)`,
          [id, owner, jobId, JSON.stringify(resume), isBase],
        );
      const withJob = randomUUID();
      const orphan = randomUUID();
      const owned = randomUUID();
      await insert(withJob, null, job.id, false);
      await insert(orphan, null, null, true);
      await insert(owned, userId, null, true);

      await client.query(sql);

      const { rows } = await client.query<{ id: string; user_id: string }>(
        'select id, user_id from resume_versions where id = any($1)',
        [[withJob, orphan, owned]],
      );
      const owners = Object.fromEntries(rows.map((r) => [r.id, r.user_id]));
      assert.equal(owners[withJob], userId, "a version with a job takes the job's owner");
      assert.equal(owners[orphan], undefined, 'a version with no owner and no job is removed');
      assert.equal(owners[owned], userId);

      const columns = await client.query<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable from information_schema.columns
          where table_name = 'resume_versions' and column_name in ('user_id', 'based_on')`,
      );
      const byName = Object.fromEntries(columns.rows.map((c) => [c.column_name, c.is_nullable]));
      assert.equal(byName.user_id, 'NO');
      assert.equal(byName.based_on, 'YES');
    } finally {
      await client.query('rollback');
      client.release();
      await pool.query('delete from jobs where user_id = $1', [userId]);
    }
  },
);

test(
  'based_on round-trips through the Postgres store, and a version without an owner is refused',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async () => {
    const pool = getPool();
    assert.ok(pool);
    const userId = `itest_028b_${randomUUID().slice(0, 8)}`;
    const job = await createJob(userId, { company: 'Acme', title: 'Analyst', descriptionText: 'SQL.' });
    const basedOn = {
      baseVersionId: null,
      baseUpdatedAt: null,
      jobId: job.id,
      postingSha256: 'b'.repeat(64),
      model: 'openai:gpt-6-luna',
      createdAt: new Date().toISOString(),
      grounding: { version: 1 },
    };
    try {
      const id = randomUUID();
      await insertResumeVersion({
        id,
        userId,
        jobId: job.id,
        changeSummary: 'Tailored.',
        structuredResume: resume,
        approved: false,
        isBase: false,
        basedOn,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      assert.deepEqual((await getResumeVersion(userId, id))?.basedOn, basedOn);

      await assert.rejects(
        pool.query(
          `insert into resume_versions (id, user_id, job_id, change_summary, structured_resume, approved, is_base)
           values ($1, null, $2, 'x', '{}'::jsonb, false, false)`,
          [randomUUID(), job.id],
        ),
        /null value in column "user_id"/,
      );
    } finally {
      await pool.query('delete from resume_versions where user_id = $1', [userId]);
      await pool.query('delete from jobs where user_id = $1', [userId]);
    }
  },
);

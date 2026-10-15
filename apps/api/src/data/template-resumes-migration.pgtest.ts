import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createJob } from './job-store';
import { isGrounded } from '@/lib/tailor/apply';
import { findMigrationDir } from '@/lib/migrations';
import { getPool } from '@/lib/postgres';
import type { ResumeVersionRecord } from '@/types';

// Runs only against a real, ephemeral Postgres (the `db` CI job). Migration 029 (#351) deletes
// every tailored version without the API's grounding marker, approved or not, with the
// notifications that point at one and a stored pack's link to one, and then refuses new ones.
// Base résumés and checked drafts stay. It all runs in one transaction that is rolled back, so
// other test files never see the delete.
const DB = process.env.DATABASE_URL?.trim();

test(
  'migration 029 deletes the unchecked tailored versions and what points at them, then refuses new ones',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async () => {
    const pool = getPool();
    assert.ok(pool);
    const userId = `itest_029_${randomUUID().slice(0, 8)}`;
    const job = await createJob(userId, { company: 'Acme', title: 'Analyst', descriptionText: 'SQL.' });
    const dir = findMigrationDir(__dirname);
    assert.ok(dir, 'db/migrations not found');
    const sql = await readFile(join(dir, '029_delete_template_tailored_resumes.sql'), 'utf8');
    const grounded = { jobId: job.id, model: 'openai:gpt-6-luna', grounding: { version: 1 } };

    const client = await pool.connect();
    try {
      await client.query('begin');
      // The table as it was before 029, inside this transaction only.
      await client.query('alter table resume_versions drop constraint if exists resume_versions_tailored_is_grounded');
      const insert = async (fields: { isBase?: boolean; approved?: boolean; jobId?: string | null; basedOn?: unknown }) => {
        const id = randomUUID();
        await client.query(
          `insert into resume_versions (id, user_id, job_id, change_summary, structured_resume, approved, is_base, based_on)
           values ($1, $2, $3, 'x', '{}'::jsonb, $4, $5, $6)`,
          [id, userId, fields.jobId === undefined ? job.id : fields.jobId, fields.approved ?? false, fields.isBase ?? false, fields.basedOn === undefined ? null : JSON.stringify(fields.basedOn)],
        );
        return id;
      };
      const kept = {
        base: await insert({ isBase: true, jobId: null, approved: true }),
        checked: await insert({ basedOn: grounded }),
        checkedApproved: await insert({ basedOn: grounded, approved: true }),
      };
      const deleted = {
        template: await insert({}),
        templateApproved: await insert({ approved: true }),
        templateNoJob: await insert({ jobId: null }),
        jsonNull: await insert({ basedOn: null }),
        basisWithoutGrounding: await insert({ basedOn: { jobId: job.id } }),
        groundingNull: await insert({ basedOn: { grounding: null } }),
        wrongVersion: await insert({ basedOn: { grounding: { version: 0 } } }),
      };
      // 'null'::jsonb (a JSON null, not SQL NULL) is unchecked too.
      const jsonbNull = randomUUID();
      await client.query(
        `insert into resume_versions (id, user_id, job_id, change_summary, structured_resume, approved, is_base, based_on)
         values ($1, $2, $3, 'x', '{}'::jsonb, false, false, 'null'::jsonb)`,
        [jsonbNull, userId, job.id],
      );

      const notify = (key: string) =>
        client.query(
          `insert into notifications (id, user_id, kind, title, body, dedupe_key) values ($1, $2, 'approval_needed', 'Review', 'Review it.', $3)`,
          [randomUUID(), userId, key],
        );
      await notify(`approval_needed:resume:${deleted.template}`);
      await notify(`approval_needed:resume:${kept.checked}`);
      const pack = randomUUID();
      await client.query(
        `insert into agent_outputs (id, job_id, user_id, kind, payload) values ($1, $2, $3, 'application_pack', $4)`,
        [pack, job.id, userId, JSON.stringify({ jobId: job.id, resumeVersionId: deleted.templateApproved, resumeFileUrl: 'blob://x.pdf', answers: [] })],
      );

      await client.query(sql);
      // Safe to run again (the runner re-runs migrations after a lost history).
      await client.query(sql);

      const { rows } = await client.query<{ id: string; is_base: boolean; based_on: ResumeVersionRecord['basedOn'] }>(
        'select id, is_base, based_on from resume_versions where user_id = $1',
        [userId],
      );
      assert.deepEqual(rows.map((row) => row.id).sort(), Object.values(kept).sort());
      assert.ok(rows.every((row) => row.is_base || isGrounded({ basedOn: row.based_on })), 'what is left, the API can use');

      const keys = await client.query<{ dedupe_key: string }>('select dedupe_key from notifications where user_id = $1', [userId]);
      assert.deepEqual(keys.rows.map((row) => row.dedupe_key), [`approval_needed:resume:${kept.checked}`]);
      const packs = await client.query<{ payload: Record<string, unknown> }>('select payload from agent_outputs where id = $1', [pack]);
      assert.equal(packs.rows[0]?.payload.resumeVersionId, null);
      assert.equal(packs.rows[0]?.payload.resumeFileUrl, null);
      assert.equal(packs.rows[0]?.payload.jobId, job.id);

      // New unchecked tailored versions are refused, whoever writes them; base ones are fine.
      await client.query('savepoint refused');
      await assert.rejects(insert({}), /resume_versions_tailored_is_grounded/);
      await client.query('rollback to savepoint refused');
      await assert.rejects(insert({ basedOn: { grounding: { version: 0 } } }), /resume_versions_tailored_is_grounded/);
      await client.query('rollback to savepoint refused');
      await insert({ isBase: true, jobId: null });
      await insert({ basedOn: grounded });
    } finally {
      await client.query('rollback');
      client.release();
      await pool.query('delete from jobs where user_id = $1', [userId]);
    }
  },
);

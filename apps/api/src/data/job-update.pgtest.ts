import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createJob, updateJob } from './job-store';
import { getPool } from '@/lib/postgres';

// Runs only against a real, ephemeral Postgres (the `db` CI job). #412: null clears the notes,
// the next action and the follow-up; a field left out of the update keeps its value.
const DB = process.env.DATABASE_URL?.trim();

test(
  'updateJob clears the notes, next action and follow-up given null, and keeps those left out',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async () => {
    const pool = getPool();
    assert.ok(pool);
    const userId = `itest_412_${randomUUID().slice(0, 8)}`;
    const job = await createJob(userId, { company: 'Acme', title: 'Engineer', descriptionText: 'Go and Postgres.' });
    const row = async () =>
      (
        await pool.query<{ notes: string | null; next_action: string | null; next_action_due: Date | null }>(
          'select notes, next_action, next_action_due from jobs where id::text = $1',
          [job.id],
        )
      ).rows[0];

    await updateJob(userId, job.id, {
      notes: 'Call Sam',
      nextAction: 'Send the follow-up',
      nextActionDue: '2026-10-20T13:00:00.000Z',
    });
    await updateJob(userId, job.id, { priority: 'high' });
    const kept = await row();
    assert.equal(kept?.notes, 'Call Sam');
    assert.equal(kept?.next_action, 'Send the follow-up');
    assert.equal(kept?.next_action_due?.toISOString(), '2026-10-20T13:00:00.000Z');

    await updateJob(userId, job.id, { notes: null, nextAction: null, nextActionDue: null });
    assert.deepEqual(await row(), { notes: null, next_action: null, next_action_due: null });
  },
);

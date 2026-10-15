import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createJob, getJobById, getStoreMode } from './job-store';
import { getPool } from '@/lib/postgres';

// Postgres only, like postgres-tenancy.pgtest.ts: run via `npm run test:pg` against an
// EPHEMERAL database.
const DB = process.env.DATABASE_URL?.trim();

/**
 * #355: a job added without a location, workplace or employment type was stored as
 * "Remote", "remote" and "Full-time", and a NULL column was read back the same way. What
 * the posting doesn't state is stored as NULL and read as unstated.
 */
test(
  'a job stores and reads no location, workplace or employment type it was not given',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async () => {
    assert.equal(getStoreMode(), 'postgres', 'expected the Postgres backend to be active');
    const user = `itest_unstated_${randomUUID().slice(0, 8)}`;

    const unstated = await createJob(user, { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs.' });
    const { rows } = await getPool()!.query<{ location: string | null; workplace_type: string | null; employment_type: string | null }>(
      'select location, workplace_type, employment_type from jobs where id = $1',
      [unstated.id],
    );
    assert.deepEqual(rows[0], { location: null, workplace_type: null, employment_type: null });
    for (const job of [unstated, await getJobById(user, unstated.id)]) {
      assert.equal(job?.location, '');
      assert.equal(job?.workplaceType, null);
      assert.equal(job?.employmentType, '');
    }

    const stated = await createJob(user, {
      company: 'Globex',
      title: 'Engineer',
      descriptionText: 'Build APIs in London.',
      location: 'London, United Kingdom',
      workplaceType: 'hybrid',
      employmentType: 'Contract',
    });
    const fetched = await getJobById(user, stated.id);
    assert.equal(fetched?.location, 'London, United Kingdom');
    assert.equal(fetched?.workplaceType, 'hybrid');
    assert.equal(fetched?.employmentType, 'Contract');
  },
);

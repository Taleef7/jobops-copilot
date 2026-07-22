import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createJob, getJobById, getStoreMode, listJobs } from './job-store';
import { createSavedSearch, deleteSavedSearch, listSavedSearches } from './saved-search-store';

// This suite runs ONLY against a real Postgres. It is named *.pgtest.ts so the file-mode
// runner (`npm test`, which globs *.test.ts) never picks it up; run it via `npm run test:pg`
// with DATABASE_URL pointed at an EPHEMERAL database (see the `db` CI job). It proves the
// hand-written `where user_id = $1` tenancy boundary in the *.postgres.ts stores — the code
// every file-mode store test skips by deleting DATABASE_URL.
const DB = process.env.DATABASE_URL?.trim();

test(
  'Postgres stores enforce cross-tenant isolation',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async (t) => {
    assert.equal(getStoreMode(), 'postgres', 'expected the Postgres backend to be active');

    const suffix = randomUUID().slice(0, 8);
    const userA = `itest_A_${suffix}`;
    const userB = `itest_B_${suffix}`;

    await t.test('jobs: a user cannot list or read another user’s job', async () => {
      const jobA = await createJob(userA, { company: 'Acme', title: 'Eng A', descriptionText: 'a' });
      const jobB = await createJob(userB, { company: 'Globex', title: 'Eng B', descriptionText: 'b' });

      const listA = await listJobs(userA);
      assert.ok(listA.some((j) => j.id === jobA.id), 'A sees its own job');
      assert.ok(!listA.some((j) => j.id === jobB.id), 'A must NOT see B’s job in its list');

      assert.equal(await getJobById(userA, jobB.id), undefined, 'A cannot read B’s job by id');
      assert.equal(await getJobById(userB, jobA.id), undefined, 'B cannot read A’s job by id');
    });

    await t.test('saved searches: scoped per user; cannot delete another user’s', async () => {
      const searchA = await createSavedSearch(userA, { query: 'python backend' });
      const searchB = await createSavedSearch(userB, { query: 'rust systems' });

      const listA = await listSavedSearches(userA);
      assert.ok(listA.some((s) => s.id === searchA.id), 'A sees its own saved search');
      assert.ok(!listA.some((s) => s.id === searchB.id), 'A must NOT see B’s saved search');

      assert.equal(await deleteSavedSearch(userA, searchB.id), false, 'A cannot delete B’s saved search');
      assert.ok(
        (await listSavedSearches(userB)).some((s) => s.id === searchB.id),
        'B’s saved search must survive A’s delete attempt',
      );
    });
  },
);

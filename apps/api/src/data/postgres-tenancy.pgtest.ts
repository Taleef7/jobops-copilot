import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createJob, getJobById, getStoreMode, listJobs, saveJobAnalysis, updateJob } from './job-store';
import { createSavedSearch, deleteSavedSearch, listSavedSearches } from './saved-search-store';
import { ANALYZED_NEXT_ACTION, UNSCORED_NEXT_ACTION } from '@/lib/analysis-workflow';
import { PRERANK_MODEL } from '@/lib/local-fit';

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

    // saveJobAnalysis writes next_action through `coalesce($n, next_action)`,
    // which only a real database evaluates — the file-mode store takes a
    // different branch entirely. Before this, a scored job kept telling you to
    // score it.
    await t.test('jobs: saving an analysis advances the next action', async () => {
      const job = await createJob(userA, {
        company: 'Initech',
        title: 'Platform Engineer',
        descriptionText: 'Kubernetes, Go, Postgres',
      });
      assert.equal(job.nextAction, UNSCORED_NEXT_ACTION, 'a new job asks to be scored');

      const analysis = { ...job.analysis, modelUsed: 'gpt-4o', fitSummary: 'Strong overlap' };
      const scored = await saveJobAnalysis(userA, job.id, analysis, 82);

      assert.equal(scored?.fitScore, 82);
      assert.equal(scored?.nextAction, ANALYZED_NEXT_ACTION, 'a scored job stops asking to be scored');
    });

    // A pre-rank that clears the evidence floor DOES carry a number, so it has
    // to be excluded by its model rather than by the absence of a score.
    await t.test('jobs: a pre-rank leaves the next action asking to be scored', async () => {
      const job = await createJob(userA, {
        company: 'Hooli',
        title: 'Data Engineer',
        descriptionText: 'Airflow, dbt',
      });

      const estimate = { ...job.analysis, modelUsed: PRERANK_MODEL };
      const prerank = await saveJobAnalysis(userA, job.id, estimate, 100);

      assert.equal(
        prerank?.nextAction,
        UNSCORED_NEXT_ACTION,
        'discovery’s keyword estimate is not a scoring run',
      );
    });

    // POST /ai/parse-job saves an analysis with no fitScore at all.
    await t.test('jobs: a parse with no score leaves the prompt to score', async () => {
      const job = await createJob(userA, {
        company: 'Umbrella',
        title: 'SRE',
        descriptionText: 'Terraform, incident response',
      });

      const parsed = await saveJobAnalysis(userA, job.id, {
        ...job.analysis,
        modelUsed: 'mock-analysis-v1',
      });

      assert.equal(parsed?.nextAction, UNSCORED_NEXT_ACTION, 'a parse is not a scoring run');
    });

    // The write re-checks next_action itself rather than trusting the value
    // read before the analysis insert, so a next action written in between is
    // not clobbered. (The read-then-write race is not reproducible from here;
    // this covers the guard's ordinary path.)
    await t.test('jobs: scoring does not overwrite a user-written next action', async () => {
      const job = await createJob(userA, {
        company: 'Stark',
        title: 'ML Engineer',
        descriptionText: 'PyTorch, CUDA',
      });

      const mine = 'Ping Dana about the referral';
      await updateJob(userA, job.id, { nextAction: mine });

      const scored = await saveJobAnalysis(
        userA,
        job.id,
        { ...job.analysis, modelUsed: 'gpt-4o' },
        88,
      );

      assert.equal(scored?.fitScore, 88, 'the score still lands');
      assert.equal(scored?.nextAction, mine, 'the user’s next action is theirs to keep');
    });
  },
);

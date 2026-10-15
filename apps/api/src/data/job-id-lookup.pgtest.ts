import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { appendOutreachDraft, createJob, getJobById, getStoreMode, saveJobAnalysis, updateJob } from './job-store';
import { getPool } from '@/lib/postgres';
import { sampleAnalysis } from '@/test-support/analysis';

// Postgres only, like postgres-tenancy.pgtest.ts: run via `npm run test:pg` against an
// EPHEMERAL database.
const DB = process.env.DATABASE_URL?.trim();

type PlanNode = { 'Node Type': string; Plans?: PlanNode[] };

function nodeTypes(node: PlanNode): string[] {
  return [node['Node Type'], ...(node.Plans ?? []).flatMap(nodeTypes)];
}

/**
 * #353: job lookups compared `id::text = $1`, which no index on a uuid column can serve, so
 * every job read scanned job_analysis and outreach whole. They compare `id = $1::uuid` now,
 * and an id that isn't a UUID is "not found" without a query (it would be a cast error).
 */
test(
  'job lookups by id use an index, and a malformed id is not found',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async (t) => {
    assert.equal(getStoreMode(), 'postgres', 'expected the Postgres backend to be active');
    const user = `itest_id_${randomUUID().slice(0, 8)}`;
    const job = await createJob(user, { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs.' });

    await t.test('reading a job by id scans no table', async () => {
      const pool = getPool()!;
      const queries: { text: string; values?: unknown[] }[] = [];
      const query = pool.query.bind(pool);
      pool.query = ((text: string, values?: unknown[]) => {
        queries.push({ text, values });
        return query(text, values);
      }) as unknown as typeof pool.query;
      try {
        assert.equal((await getJobById(user, job.id))?.id, job.id);
      } finally {
        Reflect.deleteProperty(pool, 'query');
      }

      assert.equal(queries.length, 3, 'the job, its analysis and its outreach');
      const client = await pool.connect();
      try {
        // With sequential scans priced out, the planner scans a table only when no index fits.
        await client.query('set enable_seqscan = off');
        for (const { text, values } of queries) {
          const { rows } = await client.query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(`explain (format json) ${text}`, values);
          const types = nodeTypes(rows[0]!['QUERY PLAN'][0]!.Plan);
          assert.ok(!types.includes('Seq Scan'), `sequential scan (${types.join(' > ')}) in: ${text.trim()}`);
        }
      } finally {
        await client.query('reset enable_seqscan');
        client.release();
      }
    });

    await t.test('a malformed id is not found, not a database error', async () => {
      const draft = {
        id: randomUUID(),
        messageType: 'recruiter_email' as const,
        draftText: 'Hello',
        status: 'drafted' as const,
        createdAt: new Date().toISOString(),
      };
      for (const id of ['not-a-real-id', `${job.id}x`, '']) {
        assert.equal(await getJobById(user, id), undefined);
        assert.equal(await updateJob(user, id, { notes: 'Called the recruiter' }), undefined);
        assert.equal(await appendOutreachDraft(user, id, draft), undefined);
        assert.equal(await saveJobAnalysis(user, id, sampleAnalysis(), 70), undefined);
      }
      // A real id still works.
      assert.equal((await getJobById(user, job.id))?.id, job.id);
      assert.equal((await updateJob(user, job.id, { notes: 'Called the recruiter' }))?.notes, 'Called the recruiter');
    });
  },
);

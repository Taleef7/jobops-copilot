import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { insertJobContact, listJobContacts } from './contact-store';
import { applyJobDedupe, loadDedupeRows } from './job-dedupe.postgres';
import { backfillCanonicalUrls, createJob, findJobByCanonicalUrl, listJobs, saveJobAnalysis } from './job-store';
import { runDiscoveryForUser } from '@/lib/discovery';
import { dedupeJobs, planJobDedupe } from '@/lib/job-dedupe';
import type { SourcedJob } from '@/lib/job-sources/normalize';
import { migrateOnBoot } from '@/lib/migrate-on-boot';
import { getPool } from '@/lib/postgres';
import { jobsRouter } from '@/routes/jobs';
import { sampleAnalysis } from '@/test-support/analysis';

// #346: discovery re-inserted the same Adzuna ads on every run. Runs only against a real,
// ephemeral Postgres (see the `db` CI job).
const DB = process.env.DATABASE_URL?.trim();
const skip = DB ? false : 'DATABASE_URL not set — Postgres integration test skipped';

const adzuna = (id: string, se: string) =>
  `https://www.adzuna.com/land/ad/${id}?se=${se}&utm_medium=api&utm_source=abc&v=${se}`;
const newUser = () => `itest_346_${randomUUID().slice(0, 8)}`;
function db() {
  const pool = getPool();
  assert.ok(pool, 'DATABASE_URL is set but there is no pool');
  return pool;
}

/**
 * A copy stored before #346: createJob now refuses a second copy of a posting, so the
 * duplicates live accounts already hold are written directly.
 */
async function storeLegacyCopy(userId: string, body: Parameters<typeof createJob>[1]) {
  const job = await createJob(userId, { ...body, jobUrl: undefined });
  await db().query('update jobs set job_url = $2, canonical_url = null where id = $1', [job.id, body.jobUrl]);
  return { ...job, jobUrl: body.jobUrl };
}

async function canonicalOf(jobId: string): Promise<string | null> {
  const { rows } = await db().query<{ canonical_url: string | null }>(
    'select canonical_url from jobs where id = $1',
    [jobId],
  );
  return rows[0]?.canonical_url ?? null;
}

test('a new job stores its canonical URL, and the lookup finds it through any tracking variant', { skip }, async () => {
  const userId = newUser();
  const other = newUser();
  const job = await createJob(userId, {
    company: 'ManTech',
    title: 'Software Engineer',
    descriptionText: 'x',
    jobUrl: adzuna('5001', 'first'),
  });

  assert.equal(await canonicalOf(job.id), 'adzuna:5001');
  assert.equal((await findJobByCanonicalUrl(userId, adzuna('5001', 'second')))?.id, job.id);
  assert.equal((await findJobByCanonicalUrl(userId, 'https://www.adzuna.com/details/5001?utm_source=z'))?.id, job.id);
  assert.equal(await findJobByCanonicalUrl(other, adzuna('5001', 'first')), undefined, 'another user never sees it');
  assert.equal(await findJobByCanonicalUrl(userId, adzuna('5002', 'first')), undefined);
});

test('the boot backfill fills canonical URLs for rows stored before the column existed', { skip }, async () => {
  const userId = newUser();
  const job = await createJob(userId, {
    company: 'Palantir',
    title: 'Backend Engineer',
    descriptionText: 'x',
    jobUrl: 'https://jobs.lever.co/palantir/10dfc8bc-99ad-4ca2-ab76-853cb90a92c2/apply?lever-source=x',
  });
  await db().query('update jobs set canonical_url = null where id = $1', [job.id]);

  const filled = await backfillCanonicalUrls();

  assert.ok(filled >= 1);
  assert.equal(await canonicalOf(job.id), 'lever:10dfc8bc-99ad-4ca2-ab76-853cb90a92c2');
  assert.equal(await backfillCanonicalUrls(), 0, 'a second run has nothing left to fill');
});

test('the API fills missing canonical URLs when it boots', { skip }, async () => {
  const job = await createJob(newUser(), {
    company: 'Acme',
    title: 'Engineer',
    descriptionText: 'x',
    jobUrl: 'https://www.themuse.com/jobs/acme/engineer?utm_source=x',
  });
  await db().query('update jobs set canonical_url = null where id = $1', [job.id]);

  await migrateOnBoot();

  assert.equal(await canonicalOf(job.id), 'themuse.com/jobs/acme/engineer');
});

test('running discovery twice with the same feed inserts nothing the second time', { skip }, async () => {
  const userId = newUser();
  const feed = (se: string): SourcedJob[] => [
    { source: 'adzuna', company: 'ManTech', title: 'Software Engineer', location: 'Fort Meade', descriptionText: 'a', jobUrl: adzuna('5101', se) },
    { source: 'adzuna', company: 'Jobot', title: 'Software Engineer', location: 'Arlington', descriptionText: 'b', jobUrl: adzuna('5102', se) },
    // The Jobot job re-listed under a new ad id in the same feed.
    { source: 'adzuna', company: 'Jobot', title: 'Software Engineer', location: 'Arlington', descriptionText: 'b', jobUrl: adzuna('5103', se) },
  ];
  const run = (se: string) =>
    runDiscoveryForUser(userId, {
      source: { name: 'adzuna', search: async () => feed(se) },
      listJobs,
      createJob,
      listSavedSearches: async () => [
        { id: 's', userId, query: 'software', remoteOnly: false, createdAt: '', updatedAt: '' },
      ],
      getResume: async () => '',
      saveAnalysis: saveJobAnalysis,
    });

  const first = await run('call-one');
  const second = await run('call-two');

  assert.equal(first.inserted, 2);
  assert.equal(second.inserted, 0);
  assert.equal((await listJobs(userId)).length, 2);
});

test('adding a job whose URL is already tracked answers 409 with the existing job, without loading every job', { skip }, async () => {
  const userId = newUser();
  const existing = await createJob(userId, {
    company: 'Stripe',
    title: 'Engineer',
    descriptionText: 'x',
    jobUrl: 'https://job-boards.greenhouse.io/stripe/jobs/8172503',
  });

  const pool = db();
  const sql: string[] = [];
  const originalQuery = pool.query.bind(pool);
  (pool as unknown as { query: unknown }).query = (text: unknown, ...rest: unknown[]) => {
    sql.push(typeof text === 'string' ? text : String((text as { text?: string }).text));
    return (originalQuery as (...args: unknown[]) => unknown)(text, ...rest);
  };

  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.userId = userId;
    next();
  });
  app.use('/api/jobs', jobsRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  try {
    if (!address || typeof address === 'string') throw new Error('no server address');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company: 'Stripe',
        title: 'Engineer',
        descriptionText: 'Pasted again.',
        jobUrl: 'https://stripe.com/jobs/search?gh_jid=8172503',
      }),
    });
    const body = (await response.json()) as { existingJobId?: string; fields?: Record<string, string> };
    const requestSql = [...sql];

    assert.equal(response.status, 409);
    assert.equal(body.existingJobId, existing.id);
    assert.match(body.fields?.jobUrl ?? '', /already added this job/i);
    assert.equal((await listJobs(userId)).length, 1);
    const unbounded = requestSql.filter((text) => /from jobs where user_id = \$1(?!\s+and)/i.test(text.replace(/\s+/g, ' ')));
    assert.deepEqual(unbounded, [], 'POST /api/jobs must not list every job');
  } finally {
    (pool as unknown as { query: unknown }).query = originalQuery;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('the cleanup keeps the worked-on copy, moves notifications to it, and deletes the rest for that user only', { skip }, async () => {
  const userId = newUser();
  const bystander = newUser();
  const pool = db();
  const add = (owner: string, se: string, extra: { adId?: string; location?: string } = {}) =>
    storeLegacyCopy(owner, {
      company: 'ManTech',
      title: 'Software Engineer',
      location: extra.location ?? 'Fort Meade',
      descriptionText: 'x',
      jobUrl: adzuna(extra.adId ?? '9001', se),
    });

  // The passed job and the copy discovery brought back.
  const passed = await createJob(userId, {
    company: 'Vaco LLC', title: 'Software Engineer', location: 'Fort Wayne', descriptionText: 'x', jobUrl: adzuna('9100', 'old'),
  });
  await pool.query("update jobs set status = 'archived' where id = $1", [passed.id]);
  await insertJobContact(userId, passed.id, { name: 'A Recruiter', roleTitle: 'Recruiter' });
  const back = await storeLegacyCopy(userId, {
    company: 'Vaco LLC', title: 'Software Engineer', location: 'Fort Wayne', descriptionText: 'x', jobUrl: adzuna('9100', 'new'),
  });
  // Six copies of one job: five ad variants, and one under a new ad id.
  const copies = [];
  for (const se of ['a', 'b', 'c', 'd', 'e']) copies.push(await add(userId, se));
  copies.push(await add(userId, 'f', { adId: '9002' }));
  const other = await add(bystander, 'a');
  await add(bystander, 'b');
  await pool.query(
    `insert into notifications (id, user_id, kind, title, body, job_id) values ($1, $2, 'job_match', 't', 'b', $3)`,
    [randomUUID(), userId, copies[3]!.id],
  );

  const plan = planJobDedupe(await loadDedupeRows(userId));
  assert.equal(plan.groups.length, 2);
  assert.equal(plan.toDelete.length, 6);
  const result = await applyJobDedupe(userId, plan);

  assert.equal(result.deleted, 6);
  const left = await listJobs(userId);
  assert.deepEqual(left.map((job) => job.id).sort(), [passed.id, copies[0]!.id].sort());
  assert.equal(left.find((job) => job.id === passed.id)?.status, 'archived', 'the passed job stays passed');
  assert.equal((await listJobContacts(userId, passed.id)).length, 1, 'its work is kept');
  assert.ok(!left.some((job) => job.id === back.id));
  const { rows: notes } = await pool.query<{ job_id: string }>('select job_id from notifications where user_id = $1', [userId]);
  assert.deepEqual(notes.map((note) => note.job_id), [copies[0]!.id], 'the notification points at the kept job');
  assert.equal((await listJobs(bystander)).length, 2, "another user's jobs are untouched");
  await backfillCanonicalUrls(); // as the API does at boot
  assert.equal((await findJobByCanonicalUrl(bystander, adzuna('9001', 'z')))?.id, other.id);
  assert.deepEqual(planJobDedupe(await loadDedupeRows(userId)).groups, [], 'nothing left to clean');
});

test('dedupe-jobs is a dry run unless told to apply, and applies only to the user it is given', { skip }, async () => {
  const userId = newUser();
  for (const se of ['a', 'b', 'c']) {
    await storeLegacyCopy(userId, { company: 'Jobot', title: 'Software Engineer', location: 'Arlington', descriptionText: 'x', jobUrl: adzuna('9300', se) });
  }
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);

  await dedupeJobs(['--user', userId], log);
  assert.equal((await listJobs(userId)).length, 3, 'a dry run deletes nothing');
  assert.match(lines.join('\n'), /1 group, 2 to delete/);
  assert.match(lines.join('\n'), /Dry run/);

  await assert.rejects(dedupeJobs(['--apply'], log), /--apply needs --user/);

  await dedupeJobs(['--apply', '--user', userId], log);
  assert.equal((await listJobs(userId)).length, 1);
  assert.match(lines.join('\n'), /Deleted 2 job/);
});

test('two requests adding the same posting at once store it once; the second is refused as a duplicate', { skip }, async () => {
  const userId = newUser();
  const add = (se: string) =>
    createJob(userId, { company: 'Telos', title: 'Software Engineer', descriptionText: 'x', jobUrl: adzuna('9400', se) });

  const results = await Promise.allSettled([add('one'), add('two'), add('three')]);

  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const r of results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')) {
    assert.equal((r.reason as { code?: string }).code, '23505', 'discovery counts this as a skip');
  }
  assert.equal((await listJobs(userId)).length, 1);
});

test('concurrent manual adds of one posting answer 201 and 409', { skip }, async () => {
  const userId = newUser();
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.userId = userId;
    next();
  });
  app.use('/api/jobs', jobsRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  try {
    if (!address || typeof address === 'string') throw new Error('no server address');
    const post = (se: string) =>
      fetch(`http://127.0.0.1:${address.port}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: 'Telos', title: 'Engineer', descriptionText: 'x', jobUrl: adzuna('9500', se) }),
      });
    const statuses = (await Promise.all([post('a'), post('b')])).map((response) => response.status).sort();
    assert.deepEqual(statuses, [201, 409]);
    assert.equal((await listJobs(userId)).length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('the cleanup sees which copies have a fit score', { skip }, async () => {
  const userId = newUser();
  const older = await createJob(userId, { company: 'Kforce', title: 'Software Engineer', descriptionText: 'x', jobUrl: adzuna('9600', 'a') });
  const prerank = await createJob(userId, { company: 'Kforce', title: 'Software Engineer', descriptionText: 'x', jobUrl: 'https://example.com/kforce/1' });
  const scored = await createJob(userId, { company: 'Kforce', title: 'Software Engineer', descriptionText: 'x', jobUrl: 'https://example.com/kforce/2' });
  await saveJobAnalysis(userId, prerank.id, sampleAnalysis({ modelUsed: 'local-prerank' }), 40);
  await saveJobAnalysis(userId, scored.id, sampleAnalysis({ modelUsed: 'openai:gpt-5.4-nano' }), 62);

  const rows = await loadDedupeRows(userId);
  const byId = new Map(rows.map((r) => [r.id, r.scored]));
  assert.deepEqual([byId.get(older.id), byId.get(prerank.id), byId.get(scored.id)], [false, false, true]);
  assert.equal(planJobDedupe(rows).groups[0]?.keep, scored.id);
});

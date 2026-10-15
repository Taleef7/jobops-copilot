import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from './app';
import { listJobs, resetJobStoreForTests } from '@/data/job-store';
import { resetUsageStoreForTests } from '@/data/usage-store';
import { FAKE_PARSED_JOB } from '@/test-support/fake-agent';

/**
 * #355: the Add job form sends a pasted posting to parse-job and shows what comes back for
 * review: title, company, location and workplace from the AI, the salary as the store reads
 * it on save. Anything the posting doesn't state is null, and nothing is saved.
 */
async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const USER = 'u_parse_job';

async function parseWith(agentAnswer: unknown, descriptionText: string) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-parse-job-'));
  const savedAgent = process.env.AGENT_SERVICE_URL;
  delete process.env.DATABASE_URL;
  process.chdir(tempDir);
  await resetJobStoreForTests();
  resetUsageStoreForTests();
  const agent = await listen((request, response) => {
    request.resume();
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(agentAnswer));
  });
  process.env.AGENT_SERVICE_URL = agent.url;
  const api = await listen(createApp());
  try {
    const response = await fetch(`${api.url}/api/ai/parse-job`, {
      method: 'POST',
      headers: { 'X-User-Id': USER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description_text: descriptionText }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    const jobs = await listJobs(USER);
    return { status: response.status, body, jobs };
  } finally {
    if (savedAgent === undefined) delete process.env.AGENT_SERVICE_URL;
    else process.env.AGENT_SERVICE_URL = savedAgent;
    await api.close();
    await agent.close();
    process.chdir(originalCwd);
    await resetJobStoreForTests();
    resetUsageStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
}

test('parse-job returns the location and workplace the posting states, and its salary', async () => {
  const { status, body, jobs } = await parseWith(
    { ...FAKE_PARSED_JOB, location: 'London, United Kingdom', workplace_type: 'hybrid' },
    'Senior Engineer at Acme, London. Hybrid. The salary range is £80,000 - £95,000.',
  );

  assert.equal(status, 200);
  assert.equal(body.title, 'Engineer');
  assert.equal(body.company, 'Acme');
  assert.equal(body.location, 'London, United Kingdom');
  assert.equal(body.workplace_type, 'hybrid');
  assert.deepEqual(body.salary, { min: 80000, max: 95000, currency: 'GBP' });
  assert.deepEqual(jobs, [], 'reading a posting saves no job');
});

test('parse-job says null for what the posting does not state, also from an agent without those fields', async () => {
  // FAKE_PARSED_JOB is the answer of an agent from before #355: no location, no workplace.
  const older = await parseWith(FAKE_PARSED_JOB, 'Build APIs in Go.');
  assert.equal(older.status, 200);
  assert.equal(older.body.location, null);
  assert.equal(older.body.workplace_type, null);
  assert.equal(older.body.salary, null);

  const blank = await parseWith({ ...FAKE_PARSED_JOB, location: '  ', workplace_type: null }, 'Build APIs in Go.');
  assert.equal(blank.status, 200);
  assert.equal(blank.body.location, null);
  assert.equal(blank.body.workplace_type, null);
});

test('parse-job treats a workplace it does not know as an unusable answer', async () => {
  const { status, body } = await parseWith({ ...FAKE_PARSED_JOB, workplace_type: 'anywhere' }, 'Build APIs in Go.');

  assert.equal(status, 503);
  assert.equal(body.retryable, true);
});

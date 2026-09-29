import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from './app';
import { createJob, resetJobStoreForTests } from '@/data/job-store';
import { upsertUserProfile } from '@/data/profile-store';
import { getTodayUsage, resetUsageStoreForTests } from '@/data/usage-store';

/**
 * #345: the AI budget is only charged for requests that reach the agent. Before, every
 * /api/ai request reserved budget up front and kept it, including 400s and 404s (seen on
 * live: three rejected requests added three calls and $0.03).
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

const USER = 'u_budget_settle';
const settled = () => new Promise((resolve) => setTimeout(resolve, 100));

test('rejected and agent-less /api/ai requests are not charged; an agent call is', async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-budget-'));
  const savedAgent = process.env.AGENT_SERVICE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.AGENT_SERVICE_URL;
  process.chdir(tempDir);
  await resetJobStoreForTests();
  resetUsageStoreForTests();
  const api = await listen(createApp());
  const agentCalls: string[] = [];
  const agent = await listen((request, response) => {
    agentCalls.push(`${request.method} ${request.url}`);
    request.resume();
    response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
  });
  const post = (body: unknown) =>
    fetch(`${api.url}/api/ai/score-fit`, {
      method: 'POST',
      headers: { 'X-User-Id': USER, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    const job = await createJob(USER, { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs in Go.' });

    assert.equal((await post({})).status, 400);
    assert.equal((await post({ job_id: '00000000-0000-0000-0000-000000000000' })).status, 404);
    assert.equal((await post({ job_id: job.id })).status, 400); // no résumé on file
    await settled();
    assert.deepEqual(await getTodayUsage(USER), { costUsd: 0, calls: 0 }, '4xx responses must not be charged');

    // With no agent configured the score comes from the local fallback: nothing was paid for.
    await upsertUserProfile(USER, { resumeText: 'Backend engineer. Go, Postgres.' });
    assert.equal((await post({ job_id: job.id })).status, 200);
    await settled();
    assert.deepEqual(await getTodayUsage(USER), { costUsd: 0, calls: 0 }, 'a request that never reached the agent is refunded');

    // With the agent configured, the parse and score calls are charged once, by input size.
    process.env.AGENT_SERVICE_URL = agent.url;
    await post({ job_id: job.id });
    await settled();
    assert.deepEqual(agentCalls, ['POST /parse-job', 'POST /score-fit']);
    const usage = await getTodayUsage(USER);
    assert.equal(usage.calls, 1);
    assert.ok(usage.costUsd >= 0.01, `expected at least the flat reservation, got ${usage.costUsd}`);
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
});

test('a large input that would pass the daily ceiling is refused before the agent is called', async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-budget-ceiling-'));
  const saved = { agent: process.env.AGENT_SERVICE_URL, budget: process.env.AI_DAILY_BUDGET_USD };
  delete process.env.DATABASE_URL;
  process.chdir(tempDir);
  await resetJobStoreForTests();
  resetUsageStoreForTests();
  const agentCalls: string[] = [];
  const agent = await listen((request, response) => {
    agentCalls.push(`${request.method} ${request.url}`);
    request.resume();
    response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
  });
  process.env.AGENT_SERVICE_URL = agent.url;
  // Room for the flat $0.01 reservation, but not for a 20k-character parse on top.
  process.env.AI_DAILY_BUDGET_USD = '0.011';
  const api = await listen(createApp());
  try {
    await upsertUserProfile(USER, { resumeText: 'Backend engineer. Go, Postgres.' });
    const job = await createJob(USER, { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs. '.repeat(8_000) });
    const response = await fetch(`${api.url}/api/ai/score-fit`, {
      method: 'POST',
      headers: { 'X-User-Id': USER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: job.id }),
    });
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: 'Daily AI budget reached' });
    assert.deepEqual(agentCalls, [], 'the agent must not be called');
    await settled();
    assert.deepEqual(await getTodayUsage(USER), { costUsd: 0, calls: 0 });
  } finally {
    for (const [key, value] of [['AGENT_SERVICE_URL', saved.agent], ['AI_DAILY_BUDGET_USD', saved.budget]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await api.close();
    await agent.close();
    process.chdir(originalCwd);
    await resetJobStoreForTests();
    resetUsageStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});

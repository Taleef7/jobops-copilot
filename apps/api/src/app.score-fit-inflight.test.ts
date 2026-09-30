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
import { fakeAgentAnswer } from '@/test-support/fake-agent';

/**
 * #345: opening a job auto-scores it while the Score fit button is live, and a reload or a
 * second tab does the same, so one job could be scored (and paid for) several times at
 * once. A second request for the same job now waits for the first and gets its result.
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

const USER = 'u_inflight';

test('two concurrent Score fit requests for one job make one parse and one score call', async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-inflight-'));
  const savedAgent = process.env.AGENT_SERVICE_URL;
  delete process.env.DATABASE_URL;
  process.chdir(tempDir);
  await resetJobStoreForTests();
  resetUsageStoreForTests();
  const agentCalls: string[] = [];
  const agent = await listen((request, response) => {
    agentCalls.push(`${request.method} ${request.url}`);
    request.resume();
    // Slow enough that the second request arrives while the first is still scoring.
    setTimeout(() => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(fakeAgentAnswer(request.url))), 300);
  });
  process.env.AGENT_SERVICE_URL = agent.url;
  const api = await listen(createApp());
  const score = (jobId: string, resumeText?: string) =>
    fetch(`${api.url}/api/ai/score-fit`, {
      method: 'POST',
      headers: { 'X-User-Id': USER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, ...(resumeText ? { resume_text: resumeText } : {}) }),
    });
  try {
    await upsertUserProfile(USER, { resumeText: 'Backend engineer. Go, Postgres.' });
    const job = await createJob(USER, { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs in Go.' });
    const other = await createJob(USER, { company: 'Globex', title: 'Engineer', descriptionText: 'Build APIs in Rust.' });

    const [first, second] = await Promise.all([score(job.id), score(job.id)]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), await first.json());
    assert.deepEqual(agentCalls, ['POST /parse-job', 'POST /score-fit']);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await getTodayUsage(USER)).calls, 1, 'the waiting request is not charged');

    // Different jobs still score in parallel, and a later request scores again.
    agentCalls.length = 0;
    await Promise.all([score(job.id), score(other.id)]);
    assert.equal(agentCalls.length, 4);

    // A request with a different résumé is its own score, not the other one's result.
    agentCalls.length = 0;
    await Promise.all([score(job.id), score(job.id, 'Frontend engineer. React.')]);
    assert.equal(agentCalls.length, 4);
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

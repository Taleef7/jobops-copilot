import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from './app';
import { resetJobStoreForTests } from '@/data/job-store';

/**
 * #349: when the AI can't answer, the API says so (503, retryable) and saves nothing.
 * Before, it quietly answered with a keyword-based fake and saved it as the result.
 * The agent URL points at a closed port, so every agent call fails at once.
 */
test('every AI route answers 503 retryable when the agent is down, and nothing is saved', async () => {
  const originalCwd = process.cwd();
  const originalAgent = process.env.AGENT_SERVICE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-ai-down-'));
  delete process.env.DATABASE_URL;
  process.env.AGENT_SERVICE_URL = 'http://127.0.0.1:9';
  process.chdir(tempDir);
  await resetJobStoreForTests();
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  const base = `http://127.0.0.1:${address.port}`;
  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'X-User-Id': 'u_ai_down', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  try {
    assert.equal((await send('POST', '/api/profile/resume', { resume_text: 'Backend engineer. Python, Postgres, TypeScript.' })).status, 200);
    const created = await send('POST', '/api/jobs', { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs in Python.' });
    assert.equal(created.status, 201);
    const jobId = ((await created.json()) as { job: { id: string } }).job.id;
    const before = ((await (await send('GET', `/api/jobs/${jobId}`)).json()) as { job: unknown }).job;

    const calls: Array<[string, string, unknown]> = [
      ['score-fit', '/api/ai/score-fit', { job_id: jobId }],
      ['parse-job', '/api/ai/parse-job', { description_text: 'Build APIs in Python.' }],
      ['draft-outreach', '/api/ai/draft-outreach', { job_id: jobId, message_type: 'recruiter_email' }],
      ['cover letter', '/api/ai/draft-outreach', { job_id: jobId, message_type: 'cover_letter' }],
      ['interview prep', '/api/ai/agents/interview-prep', { job_id: jobId }],
      ['research', '/api/ai/agents/research', { job_id: jobId }],
      ['résumé import', '/api/profile/base-resume/parse-resume', {}],
    ];
    for (const [label, path, body] of calls) {
      const response = await send('POST', path, body);
      const payload = (await response.json()) as { error?: string; retryable?: boolean };
      assert.equal(response.status, 503, `${label}: expected 503, got ${response.status} ${JSON.stringify(payload)}`);
      assert.equal(payload.retryable, true, `${label}: retryable`);
      assert.ok(payload.error && payload.error.length > 0, `${label}: a reason`);
    }

    const after = ((await (await send('GET', `/api/jobs/${jobId}`)).json()) as { job: unknown }).job;
    assert.deepEqual(after, before, 'a failed AI call changes nothing on the job (no fake score, no draft)');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.chdir(originalCwd);
    if (originalAgent === undefined) delete process.env.AGENT_SERVICE_URL;
    else process.env.AGENT_SERVICE_URL = originalAgent;
    await resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('interview prep, research and skill gap answer 503 retryable on an unusable answer, and save nothing', async () => {
  const originalCwd = process.cwd();
  const originalAgent = process.env.AGENT_SERVICE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-ai-unusable-'));
  // The agent answers 200 with an empty object: reachable, but nothing the app can show.
  const agent = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{}');
  });
  await new Promise<void>((resolve) => agent.listen(0, resolve));
  const agentAddress = agent.address();
  if (!agentAddress || typeof agentAddress === 'string') throw new Error('no agent address');
  delete process.env.DATABASE_URL;
  process.env.AGENT_SERVICE_URL = `http://127.0.0.1:${agentAddress.port}`;
  process.chdir(tempDir);
  await resetJobStoreForTests();
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  const base = `http://127.0.0.1:${address.port}`;
  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'X-User-Id': 'u_ai_unusable', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  try {
    const created = await send('POST', '/api/jobs', { company: 'Acme', title: 'Engineer', descriptionText: 'Build APIs in Python.' });
    const jobId = ((await created.json()) as { job: { id: string } }).job.id;

    for (const path of ['/api/ai/agents/interview-prep', '/api/ai/agents/research', '/api/ai/agents/skill-gap']) {
      const response = await send('POST', path, { job_id: jobId });
      const payload = (await response.json()) as { retryable?: boolean };
      assert.equal(response.status, 503, `${path}: expected 503, got ${response.status} ${JSON.stringify(payload)}`);
      assert.equal(payload.retryable, true, `${path}: retryable`);
    }

    const outputs = (await (await send('GET', `/api/jobs/${jobId}/agent-outputs`)).json()) as { outputs: unknown[] };
    assert.deepEqual(outputs.outputs, [], 'an unusable answer is never saved as an agent output');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    agent.closeAllConnections();
    await new Promise<void>((resolve) => agent.close(() => resolve()));
    process.chdir(originalCwd);
    if (originalAgent === undefined) delete process.env.AGENT_SERVICE_URL;
    else process.env.AGENT_SERVICE_URL = originalAgent;
    await resetJobStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});

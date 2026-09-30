import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { healthRouter, resetStatusCacheForTests } from './health';
import { createInternalRouter } from './internal';
import { resetLlmCanaryStoreForTests } from '@/lib/llm-canary';

/**
 * #348: a model that fails every call went unnoticed for 6 days. The canary makes one tiny
 * real call on a schedule (never on a user's request), and /api/status shows its last
 * result to a signed-in user without calling the model.
 */
const ENV = ['AGENT_SERVICE_URL', 'AGENT_API_KEY', 'N8N_WEBHOOK_SECRET', 'DATABASE_URL'];

type FetchCall = { url: string; headers: Record<string, string> };

async function withApp(
  agent: (url: string) => Response | Promise<Response>,
  run: (base: string, calls: FetchCall[]) => Promise<void>,
  userId: string | null = 'user_a',
) {
  const saved = new Map(ENV.map((key) => [key, process.env[key]]));
  process.env.AGENT_SERVICE_URL = 'http://agent.test';
  process.env.AGENT_API_KEY = 'agent-key';
  process.env.N8N_WEBHOOK_SECRET = 'cron-secret';
  delete process.env.DATABASE_URL;
  resetStatusCacheForTests();
  resetLlmCanaryStoreForTests();

  const calls: FetchCall[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('http://agent.test')) return realFetch(input, init);
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return agent(url);
  }) as typeof fetch;

  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    if (userId) request.userId = userId;
    next();
  });
  app.use('/api', healthRouter);
  app.use('/internal', createInternalRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  try {
    if (!address || typeof address === 'string') throw new Error('no address');
    await run(`http://127.0.0.1:${address.port}`, calls);
  } finally {
    globalThis.fetch = realFetch;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const details = () =>
  Response.json({ status: 'ok', llm_configured: true, provider: 'openai', model: 'gpt-5.4-nano', tavily_configured: true, build_sha: 'abc' });

test('/api/status needs a signed-in user and never calls the agent without one', async () => {
  await withApp(details, async (base, calls) => {
    const response = await fetch(`${base}/api/status`);
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  }, null);
});

test('/api/status reads the agent details with the key, caches them for a minute, and never calls the model', async () => {
  await withApp(details, async (base, calls) => {
    const first = await fetch(`${base}/api/status`);
    const body = (await first.json()) as { agent: { model?: string; reachable?: boolean }; llmCanary: unknown };
    await fetch(`${base}/api/status`);

    assert.equal(first.status, 200);
    assert.equal(body.agent.model, 'gpt-5.4-nano');
    assert.equal(body.agent.reachable, true);
    assert.equal(body.llmCanary, null, 'no canary has run yet');
    assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ['/health/details']);
    assert.equal(calls[0]!.headers['x-agent-key'] ?? calls[0]!.headers.authorization?.replace(/^Bearer /, ''), 'agent-key');
    assert.ok(!calls.some((call) => call.url.includes('/health/llm')));
  });
});

test('POST /internal/llm-canary needs the cron secret', async () => {
  await withApp(details, async (base, calls) => {
    const response = await fetch(`${base}/internal/llm-canary`, { method: 'POST' });
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  });
});

test('the canary records a working model, and /api/status shows when it last passed', async () => {
  const agent = (url: string) =>
    url.endsWith('/health/llm') ? Response.json({ ok: true, model: 'gpt-5.4-nano', latency_ms: 812 }) : details();

  await withApp(agent, async (base, calls) => {
    const run = await fetch(`${base}/internal/llm-canary`, { method: 'POST', headers: { 'x-n8n-webhook-secret': 'cron-secret' } });
    const result = (await run.json()) as { ok: boolean; model: string; latencyMs: number; checkedAt: string };

    assert.equal(run.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.model, 'gpt-5.4-nano');
    assert.equal(result.latencyMs, 812);
    assert.ok(!Number.isNaN(Date.parse(result.checkedAt)));
    const llmCall = calls.find((call) => call.url.endsWith('/health/llm'))!;
    assert.equal(llmCall.headers['x-agent-key'] ?? llmCall.headers.authorization?.replace(/^Bearer /, ''), 'agent-key');

    const status = (await (await fetch(`${base}/api/status`)).json()) as { llmCanary: { ok: boolean; checkedAt: string } };
    assert.equal(status.llmCanary.ok, true);
    assert.equal(status.llmCanary.checkedAt, result.checkedAt);
  });
});

test('a failing model makes the canary answer 503 with the provider error, and it is recorded', async () => {
  const agent = (url: string) =>
    url.endsWith('/health/llm')
      ? Response.json({ ok: false, model: 'gpt-6-luna', error: 'Function tools with reasoning_effort are not supported for gpt-6-luna' }, { status: 503 })
      : details();

  await withApp(agent, async (base) => {
    const run = await fetch(`${base}/internal/llm-canary`, { method: 'POST', headers: { 'x-n8n-webhook-secret': 'cron-secret' } });
    const result = (await run.json()) as { ok: boolean; error: string };

    assert.equal(run.status, 503);
    assert.equal(result.ok, false);
    assert.match(result.error, /gpt-6-luna/);

    const status = (await (await fetch(`${base}/api/status`)).json()) as { llmCanary: { ok: boolean; error: string } };
    assert.equal(status.llmCanary.ok, false);
    assert.match(status.llmCanary.error, /gpt-6-luna/);
  });
});

test('an unreachable agent fails the canary with a plain reason', async () => {
  const agent = (url: string) => {
    if (url.endsWith('/health/llm')) throw new TypeError('fetch failed');
    return details();
  };

  await withApp(agent, async (base) => {
    const run = await fetch(`${base}/internal/llm-canary`, { method: 'POST', headers: { 'x-n8n-webhook-secret': 'cron-secret' } });
    const result = (await run.json()) as { ok: boolean; error: string };

    assert.equal(run.status, 503);
    assert.equal(result.ok, false);
    assert.match(result.error, /agent/i);
  });
});

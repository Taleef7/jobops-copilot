import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, test } from 'node:test';
import express from 'express';
import { noteAgentCall } from './ai-call-context';
import { createDailyBudgetGuard } from './budget';

const original = process.env.AI_DAILY_BUDGET_USD;
afterEach(() => {
  if (typeof original === 'undefined') delete process.env.AI_DAILY_BUDGET_USD;
  else process.env.AI_DAILY_BUDGET_USD = original;
});

async function withGuard(allowed: boolean, run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use((request, _response, next) => {
    request.userId = request.header('X-User-Id')?.trim();
    next();
  });
  // Inject the reservation result so the test is independent of the store.
  app.use(createDailyBudgetGuard({ reserve: async () => ({ allowed, costUsd: 0 }), adjust: async () => undefined }));
  app.get('/x', (_request, response) => response.json({ ok: true }));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Test server did not provide a usable address');
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('rejects with 429 when the reservation is denied (budget reached)', async () => {
  await withGuard(false, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/x`, { headers: { 'X-User-Id': 'u_over' } });
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: 'Daily AI budget reached' });
  });
});

test('allows the request when the reservation succeeds', async () => {
  await withGuard(true, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/x`, { headers: { 'X-User-Id': 'u_under' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
});

// #345: the reservation is settled when the response finishes. A request that never
// reached the agent (400, 404, disabled agent) is refunded; a large input is topped up.
async function withSettlingGuard(run: (baseUrl: string, adjustments: Array<[string, number, number]>) => Promise<void>) {
  const adjustments: Array<[string, number, number]> = [];
  const app = express();
  app.use((request, _response, next) => {
    request.userId = 'u_settle';
    next();
  });
  app.use(
    createDailyBudgetGuard({
      reserve: async () => ({ allowed: true, costUsd: 0.01 }),
      adjust: async (userId, deltaUsd, deltaCalls) => {
        adjustments.push([userId, deltaUsd, deltaCalls]);
      },
    }),
  );
  app.post('/invalid', (_request, response) => response.status(400).json({ error: 'job_id is required' }));
  app.post('/small', async (_request, response) => {
    await Promise.resolve();
    noteAgentCall(2_000);
    response.json({ ok: true });
  });
  // The client goes away before the handler calls the agent; the handler carries on.
  app.post('/aborted', async (request, response) => {
    request.socket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    noteAgentCall(2_000);
    void response;
  });
  app.post('/large', async (_request, response) => {
    await Promise.resolve();
    noteAgentCall(400_000);
    response.json({ ok: true });
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  try {
    await run(`http://127.0.0.1:${address.port}`, adjustments);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 50));

test('a request that never reaches the agent is refunded', async () => {
  await withSettlingGuard(async (baseUrl, adjustments) => {
    assert.equal((await fetch(`${baseUrl}/invalid`, { method: 'POST' })).status, 400);
    await settled();
    assert.deepEqual(adjustments, [['u_settle', -0.01, -1]]);
  });
});

test('a normal agent call keeps its reservation and a large one is topped up', async () => {
  await withSettlingGuard(async (baseUrl, adjustments) => {
    assert.equal((await fetch(`${baseUrl}/small`, { method: 'POST' })).status, 200);
    await settled();
    assert.equal(adjustments.length, 0);
    assert.equal((await fetch(`${baseUrl}/large`, { method: 'POST' })).status, 200);
    await settled();
    assert.equal(adjustments.length, 1);
    const [userId, deltaUsd, deltaCalls] = adjustments[0]!;
    assert.equal(userId, 'u_settle');
    assert.equal(deltaCalls, 0);
    assert.ok(deltaUsd > 0, `expected a top-up, got ${deltaUsd}`);
  });
});

test('a request whose client disconnects keeps its reservation (no free agent calls)', async () => {
  await withSettlingGuard(async (baseUrl, adjustments) => {
    await fetch(`${baseUrl}/aborted`, { method: 'POST' }).catch(() => undefined);
    await settled();
    assert.equal(adjustments.length, 0);
  });
});

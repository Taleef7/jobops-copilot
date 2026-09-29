import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, test } from 'node:test';
import express from 'express';
import { beforeAgentCall } from './ai-call-context';
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

// #345: the guard reserves a flat estimate up front. Before each paid call the agent client
// reserves whatever a large input costs on top, atomically against the ceiling, and the
// request is refused if it doesn't fit. A request that never reached the agent is refunded.
async function withSettlingGuard(
  run: (
    baseUrl: string,
    log: { reserves: Array<[number, number]>; adjustments: Array<[string, number, number]> },
  ) => Promise<void>,
  { denyExtras = false } = {},
) {
  const log = { reserves: [] as Array<[number, number]>, adjustments: [] as Array<[string, number, number]> };
  const app = express();
  app.use((request, _response, next) => {
    request.userId = 'u_settle';
    next();
  });
  app.use(
    createDailyBudgetGuard({
      reserve: async (_userId, _ceiling, costUsd, calls = 1) => {
        log.reserves.push([costUsd, calls]);
        return { allowed: !(denyExtras && calls === 0), costUsd };
      },
      adjust: async (userId, deltaUsd, deltaCalls) => {
        log.adjustments.push([userId, deltaUsd, deltaCalls]);
      },
    }),
  );
  const agentRoute = (chars: number): express.RequestHandler => async (_request, response) => {
    try {
      await beforeAgentCall(chars);
      response.json({ ok: true });
    } catch (error) {
      response.status(429).json({ error: (error as Error).name });
    }
  };
  app.post('/invalid', (_request, response) => response.status(400).json({ error: 'job_id is required' }));
  app.post('/small', agentRoute(2_000));
  app.post('/large', agentRoute(400_000));
  // The client goes away before the handler calls the agent; the handler carries on.
  app.post('/aborted', async (request, response) => {
    request.socket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await beforeAgentCall(2_000);
    void response;
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  try {
    await run(`http://127.0.0.1:${address.port}`, log);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 50));

test('a request that never reaches the agent is refunded', async () => {
  await withSettlingGuard(async (baseUrl, log) => {
    assert.equal((await fetch(`${baseUrl}/invalid`, { method: 'POST' })).status, 400);
    await settled();
    assert.deepEqual(log.adjustments, [['u_settle', -0.01, -1]]);
  });
});

test('a small agent call needs nothing extra; a large one reserves the rest before the call', async () => {
  await withSettlingGuard(async (baseUrl, log) => {
    assert.equal((await fetch(`${baseUrl}/small`, { method: 'POST' })).status, 200);
    assert.equal((await fetch(`${baseUrl}/large`, { method: 'POST' })).status, 200);
    await settled();
    assert.equal(log.adjustments.length, 0);
    // Two flat reservations (one per request), then one extra for the large input, counted as no new call.
    assert.equal(log.reserves.length, 3);
    const [extraUsd, extraCalls] = log.reserves[2]!;
    assert.ok(extraUsd > 0, `expected an extra reservation, got ${extraUsd}`);
    assert.equal(extraCalls, 0);
  });
});

test('a large input that would pass the ceiling is refused before the agent call', async () => {
  await withSettlingGuard(
    async (baseUrl, log) => {
      const response = await fetch(`${baseUrl}/large`, { method: 'POST' });
      assert.equal(response.status, 429);
      assert.deepEqual(await response.json(), { error: 'AiBudgetExceededError' });
      await settled();
      // The agent was never reached, so the flat reservation is refunded too.
      assert.deepEqual(log.adjustments, [['u_settle', -0.01, -1]]);
    },
    { denyExtras: true },
  );
});

test('a request whose client disconnects keeps its reservation (no free agent calls)', async () => {
  await withSettlingGuard(async (baseUrl, log) => {
    await fetch(`${baseUrl}/aborted`, { method: 'POST' }).catch(() => undefined);
    await settled();
    assert.equal(log.adjustments.length, 0);
  });
});

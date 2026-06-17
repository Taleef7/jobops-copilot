import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, test } from 'node:test';
import express from 'express';
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
  app.use(createDailyBudgetGuard({ reserve: async () => ({ allowed, costUsd: 0 }) }));
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

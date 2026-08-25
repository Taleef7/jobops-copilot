import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createApp } from './app';

async function withApp(run: (baseUrl: string) => Promise<void>) {
  const app = createApp({
    runLimiter: (_request, _response, next) => {
      appCalls.limiter += 1;
      next();
    },
    runBudget: (_request, _response, next) => {
      appCalls.budget += 1;
      next();
    },
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const appCalls = { limiter: 0, budget: 0 };
const auth = { headers: { 'X-User-Id': 'u_app_test' } };

test('production specialist mount guards stream/resume with or without trailing slashes, not config routes', async () => {
  appCalls.limiter = 0;
  appCalls.budget = 0;
  await withApp(async (baseUrl) => {
    for (const path of [
      '/api/agents/feed-curator/stream',
      '/api/agents/feed-curator/stream/',
      '/api/agents/feed-curator/resume',
      '/api/agents/feed-curator/resume/',
    ]) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { ...auth.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: 'u_app_test:feed-curator', payload: {} }),
      });
      assert.equal(response.status, 503);
    }

    const configGet = await fetch(`${baseUrl}/api/agents/feed-curator/config`, auth);
    assert.equal(configGet.status, 503);
    const configPut = await fetch(`${baseUrl}/api/agents/feed-curator/config`, {
      method: 'PUT',
      headers: { ...auth.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    });
    assert.equal(configPut.status, 503);
  });

  assert.equal(appCalls.limiter, 4);
  assert.equal(appCalls.budget, 4);
});

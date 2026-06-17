import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { aiRouter } from './ai';

// AGENT_SERVICE_URL is unset in tests, so the agent is "disabled" → assistant routes 503
// once they pass validation. We assert auth + validation + the disabled-agent path.
async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    const header = request.header('X-User-Id');
    if (header) request.userId = header.trim();
    next();
  });
  app.use('/api/ai', aiRouter);

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

test('POST /api/ai/assistant/run requires a signed-in user', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/ai/assistant/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description_text: 'Build agents' }),
    });
    assert.equal(res.status, 401);
  });
});

test('POST /api/ai/assistant/run requires description_text', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/ai/assistant/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'u1' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/ai/assistant/run returns 503 when the agent is not configured', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/ai/assistant/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'u1' },
      body: JSON.stringify({ description_text: 'Build agents' }),
    });
    assert.equal(res.status, 503);
  });
});

test('POST /api/ai/assistant/resume requires thread_id', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/ai/assistant/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'u1' },
      body: JSON.stringify({ approved: true }),
    });
    assert.equal(res.status, 400);
  });
});

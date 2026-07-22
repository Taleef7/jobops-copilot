import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { telemetryRouter } from './telemetry';

// Mount the router WITHOUT attachUserId to simulate an unauthenticated request
// (req.userId undefined) — the route must reject rather than reach the agent.
async function statusOf(path: string): Promise<number> {
  const app = express();
  app.use('/api/telemetry', telemetryRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Test server did not provide a usable address');
  }
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}${path}`);
    return res.status;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('GET /ev-demo requires an authenticated user', async () => {
  assert.equal(await statusOf('/api/telemetry/ev-demo'), 401);
});

test('GET /insights requires an authenticated user', async () => {
  assert.equal(await statusOf('/api/telemetry/insights'), 401);
});

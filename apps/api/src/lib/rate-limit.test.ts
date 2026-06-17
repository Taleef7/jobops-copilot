import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createRateLimiter, keyForRequest } from './rate-limit';

test('keyForRequest prefers the user id', () => {
  assert.equal(keyForRequest({ userId: 'user_1', ip: '1.2.3.4' }), 'user_1');
});

test('keyForRequest falls back to the client IP when unauthenticated', () => {
  // ipKeyGenerator returns IPv4 addresses unchanged.
  assert.equal(keyForRequest({ userId: undefined, ip: '1.2.3.4' }), '1.2.3.4');
});

test('createRateLimiter returns 429 once the limit is exceeded in a window', async () => {
  const app = express();
  app.use(createRateLimiter(2));
  app.get('/ping', (_request, response) => response.json({ ok: true }));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Test server did not provide a usable address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${baseUrl}/ping`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/ping`)).status, 200);
    const limited = await fetch(`${baseUrl}/ping`);
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: 'Too many requests, slow down.' });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

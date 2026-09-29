import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createRateLimiter, keyForRequest, limitsFromEnv } from './rate-limit';

test('keyForRequest prefers the user id', () => {
  assert.equal(keyForRequest({ userId: 'user_1', ip: '1.2.3.4' }), 'user_1');
});

test('keyForRequest falls back to the client IP when unauthenticated', () => {
  // ipKeyGenerator returns IPv4 addresses unchanged.
  assert.equal(keyForRequest({ userId: undefined, ip: '1.2.3.4' }), '1.2.3.4');
});

test('createRateLimiter returns 429 once the limit is exceeded in a window', async () => {
  const app = express();
  app.use(createRateLimiter(2, 'test'));
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

test('limitsFromEnv uses production limits on Azure even without NODE_ENV (#345)', () => {
  assert.deepEqual(limitsFromEnv({}), { windowMs: 60_000, globalMax: 1000, aiMax: 200 });
  assert.deepEqual(limitsFromEnv({ NODE_ENV: 'production' }), { windowMs: 60_000, globalMax: 120, aiMax: 20 });
  // App Service sets WEBSITE_SITE_NAME; the live API had no NODE_ENV and ran 1000/200.
  assert.deepEqual(limitsFromEnv({ WEBSITE_SITE_NAME: 'jobops-api' }), { windowMs: 60_000, globalMax: 120, aiMax: 20 });
});

test('limitsFromEnv honours explicit limits and ignores malformed ones', () => {
  assert.deepEqual(limitsFromEnv({ RATE_LIMIT_MAX: '300', RATE_LIMIT_AI_MAX: '7', RATE_LIMIT_WINDOW_MS: '30000' }), {
    windowMs: 30_000,
    globalMax: 300,
    aiMax: 7,
  });
  // NaN, zero, negative or blank would disable or break the limiter: use the default.
  assert.deepEqual(
    limitsFromEnv({ NODE_ENV: 'production', RATE_LIMIT_MAX: 'abc', RATE_LIMIT_AI_MAX: '0', RATE_LIMIT_WINDOW_MS: ' ' }),
    { windowMs: 60_000, globalMax: 120, aiMax: 20 },
  );
  assert.equal(limitsFromEnv({ RATE_LIMIT_AI_MAX: '-5' }).aiMax, 200);
});

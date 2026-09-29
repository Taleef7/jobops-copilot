import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import type express from 'express';

async function withApp(app: express.Express, run: (baseUrl: string) => Promise<void>) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Test server did not provide a usable address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const SHARED_SECRET = 'test-shared-secret';

async function pausedApp() {
  process.env.API_SHARED_SECRET = SHARED_SECRET;
  const { createApp } = await import('@/app');
  return createApp();
}

async function assertPaused(response: Response) {
  assert.equal(response.status, 410);
  const body = (await response.json()) as { code?: string; error?: string };
  assert.equal(body.code, 'EXTENSION_PAUSED');
  assert.match(body.error ?? '', /paused/i);
}

test('every /api/ext and /api/ext-tokens request answers 410 EXTENSION_PAUSED, whatever the credentials', async () => {
  const original = process.env.API_SHARED_SECRET;
  try {
    await withApp(await pausedApp(), async (baseUrl) => {
      // No credentials at all.
      await assertPaused(await fetch(`${baseUrl}/api/ext/verify`));
      // An old extension token.
      await assertPaused(
        await fetch(`${baseUrl}/api/ext/verify`, { headers: { Authorization: 'Bearer jop_old_extension_token' } }),
      );
      // The shared server key on a write: previously exempt for /api/ext.
      await assertPaused(
        await fetch(`${baseUrl}/api/ext/answers`, {
          method: 'POST',
          headers: { 'X-API-Key': SHARED_SECRET, 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionText: 'q', answer: 'a' }),
        }),
      );
      await assertPaused(await fetch(`${baseUrl}/api/ext/profile-fill`));
      await assertPaused(await fetch(`${baseUrl}/api/ext/match?url=https%3A%2F%2Fjobs.lever.co%2Fx%2F1`));
      // Token management is gone too.
      await assertPaused(await fetch(`${baseUrl}/api/ext-tokens`));
      await assertPaused(
        await fetch(`${baseUrl}/api/ext-tokens/some-id`, { method: 'DELETE', headers: { 'X-API-Key': SHARED_SECRET } }),
      );
    });
  } finally {
    if (typeof original === 'undefined') delete process.env.API_SHARED_SECRET;
    else process.env.API_SHARED_SECRET = original;
  }
});

test('the rest of the API still works and never echoes a CORS origin', async () => {
  const original = process.env.API_SHARED_SECRET;
  try {
    await withApp(await pausedApp(), async (baseUrl) => {
      const health = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://evil.example.com' } });
      assert.equal(health.status, 200);
      assert.equal(health.headers.get('access-control-allow-origin'), null);

      const extensionOrigin = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: 'chrome-extension://abcdefghijklmnop' },
      });
      assert.equal(extensionOrigin.status, 200);
      assert.equal(extensionOrigin.headers.get('access-control-allow-origin'), null);

      // A path that merely starts with the same letters is not paused.
      const answers = await fetch(`${baseUrl}/api/answers`);
      assert.notEqual(answers.status, 410);
    });
  } finally {
    if (typeof original === 'undefined') delete process.env.API_SHARED_SECRET;
    else process.env.API_SHARED_SECRET = original;
  }
});

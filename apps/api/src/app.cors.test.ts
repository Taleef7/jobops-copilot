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

test('CORS reflects an allowlisted origin but not a disallowed one', async () => {
  // Set before importing the app so corsOptions() captures the allowlist at startup.
  const original = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com';
  const { createApp } = await import('@/app');
  const app = createApp();

  try {
    await withApp(app, async (baseUrl) => {
    // Allowlisted origin → echoed back in Access-Control-Allow-Origin.
    const allowed = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://app.example.com' },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.example.com');

    // Disallowed origin → request still succeeds (no 500) but gets NO ACAO header,
    // so the browser blocks the response. This is the load-bearing deny behavior.
    const denied = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://evil.example.com' },
    });
    assert.equal(denied.status, 200);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    });
  } finally {
    if (typeof original === 'undefined') delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = original;
  }
});

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '@/app';
import { createExtToken, revokeExtToken, _resetExtTokenStoreForTests } from '@/data/ext-token-store';

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const dir = await mkdtemp(join(tmpdir(), 'jobops-ext-auth-test-'));
  try {
    process.chdir(dir);
    await _resetExtTokenStoreForTests([]);
    const app = createApp({
      runLimiter: (_req, _res, next) => next(),
      runBudget: (_req, _res, next) => next(),
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
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
  } finally {
    process.chdir(originalCwd);
    await _resetExtTokenStoreForTests([]);
    await rm(dir, { recursive: true, force: true });
  }
}

test('GET /api/ext/verify rejects unauthenticated requests with 401', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/ext/verify`);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'Missing Authorization header');
  });
});

test('GET /api/ext/verify rejects malformed or invalid token with 401', async () => {
  await withServer(async (baseUrl) => {
    // Malformed format
    const res1 = await fetch(`${baseUrl}/api/ext/verify`, {
      headers: { Authorization: 'Basic 123456' },
    });
    assert.equal(res1.status, 401);
    const body1 = (await res1.json()) as { error: string };
    assert.match(body1.error, /Expected "Bearer <token>"/);

    // Non-jop_ prefix
    const res2 = await fetch(`${baseUrl}/api/ext/verify`, {
      headers: { Authorization: 'Bearer invalid_prefix' },
    });
    assert.equal(res2.status, 401);
    const body2 = (await res2.json()) as { error: string };
    assert.match(body2.error, /Invalid personal access token format/);

    // Non-existent token
    const res3 = await fetch(`${baseUrl}/api/ext/verify`, {
      headers: { Authorization: 'Bearer jop_0123456789abcdef0123456789abcdef0123456789abcdef' },
    });
    assert.equal(res3.status, 401);
    const body3 = (await res3.json()) as { error: string };
    assert.match(body3.error, /Invalid or revoked/);
  });
});

test('GET /api/ext/verify succeeds with valid PAT and sets userId', async () => {
  await withServer(async (baseUrl) => {
    const { token, record } = await createExtToken('user_pat_tester', 'Extension Laptop');

    const res = await fetch(`${baseUrl}/api/ext/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      userId: string;
      token: { id: string; label: string; lastUsedAt?: string };
    };

    assert.equal(body.ok, true);
    assert.equal(body.userId, 'user_pat_tester');
    assert.equal(body.token.id, record.id);
    assert.equal(body.token.label, 'Extension Laptop');
    assert.ok(body.token.lastUsedAt, 'lastUsedAt touched on verification');

    // Revoking token causes subsequent calls to fail
    await revokeExtToken('user_pat_tester', record.id);
    const resAfterRevoke = await fetch(`${baseUrl}/api/ext/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(resAfterRevoke.status, 401);
    const bodyAfterRevoke = (await resAfterRevoke.json()) as { error: string };
    assert.match(bodyAfterRevoke.error, /Invalid or revoked/);
  });
});

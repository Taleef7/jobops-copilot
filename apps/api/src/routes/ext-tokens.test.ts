import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '@/app';
import { _resetExtTokenStoreForTests } from '@/data/ext-token-store';
import type { PublicExtTokenRecord } from './ext-tokens';

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const dir = await mkdtemp(join(tmpdir(), 'jobops-ext-tokens-test-'));
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

function hdrs(userId?: string) {
  return {
    'Content-Type': 'application/json',
    ...(userId ? { 'X-User-Id': userId } : {}),
  };
}

test('POST /api/ext-tokens generates a PAT and returns public metadata + raw token', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/ext-tokens`, {
      method: 'POST',
      headers: hdrs('user_test_1'),
      body: JSON.stringify({ label: 'MacBook Pro Chrome' }),
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as { token: PublicExtTokenRecord; rawToken: string };

    assert.equal(typeof body.rawToken, 'string');
    assert.match(body.rawToken, /^jop_[a-f0-9]{48}$/);
    assert.equal(body.token.userId, 'user_test_1');
    assert.equal(body.token.label, 'MacBook Pro Chrome');
    assert.equal('tokenHash' in body.token, false, 'tokenHash must never be leaked to client');
    assert.ok(body.token.id);
    assert.ok(body.token.createdAt);
  });
});

test('GET /api/ext-tokens lists user tokens and isolates tenants', async () => {
  await withServer(async (baseUrl) => {
    // Create token for user 1
    await fetch(`${baseUrl}/api/ext-tokens`, {
      method: 'POST',
      headers: hdrs('user_test_1'),
      body: JSON.stringify({ label: 'Token 1' }),
    });

    // Create token for user 2
    await fetch(`${baseUrl}/api/ext-tokens`, {
      method: 'POST',
      headers: hdrs('user_test_2'),
      body: JSON.stringify({ label: 'Token 2' }),
    });

    const res1 = await fetch(`${baseUrl}/api/ext-tokens`, {
      headers: hdrs('user_test_1'),
    });
    assert.equal(res1.status, 200);
    const body1 = (await res1.json()) as { tokens: PublicExtTokenRecord[] };
    assert.equal(body1.tokens.length, 1);
    assert.equal(body1.tokens[0]?.label, 'Token 1');
    assert.equal('tokenHash' in (body1.tokens[0] ?? {}), false);

    const res2 = await fetch(`${baseUrl}/api/ext-tokens`, {
      headers: hdrs('user_test_2'),
    });
    assert.equal(res2.status, 200);
    const body2 = (await res2.json()) as { tokens: PublicExtTokenRecord[] };
    assert.equal(body2.tokens.length, 1);
    assert.equal(body2.tokens[0]?.label, 'Token 2');
  });
});

test('DELETE /api/ext-tokens/:id revokes the token', async () => {
  await withServer(async (baseUrl) => {
    const createRes = await fetch(`${baseUrl}/api/ext-tokens`, {
      method: 'POST',
      headers: hdrs('user_test_1'),
      body: JSON.stringify({ label: 'To Revoke' }),
    });
    const created = (await createRes.json()) as { token: PublicExtTokenRecord };
    const tokenId = created.token.id;

    const deleteRes = await fetch(`${baseUrl}/api/ext-tokens/${tokenId}`, {
      method: 'DELETE',
      headers: hdrs('user_test_1'),
    });
    assert.equal(deleteRes.status, 200);
    const deleteBody = (await deleteRes.json()) as { success: boolean };
    assert.equal(deleteBody.success, true);

    // Revoking again returns 404
    const deleteAgain = await fetch(`${baseUrl}/api/ext-tokens/${tokenId}`, {
      method: 'DELETE',
      headers: hdrs('user_test_1'),
    });
    assert.equal(deleteAgain.status, 404);

    // Another user cannot revoke it
    const deleteOther = await fetch(`${baseUrl}/api/ext-tokens/${tokenId}`, {
      method: 'DELETE',
      headers: hdrs('user_test_2'),
    });
    assert.equal(deleteOther.status, 404);
  });
});

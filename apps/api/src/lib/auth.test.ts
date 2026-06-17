import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { attachUserId } from './auth';

function snapshotEnv(keys: string[]) {
  const snapshot = new Map<string, string | undefined>();
  for (const key of keys) snapshot.set(key, process.env[key]);
  return () => {
    for (const [key, value] of snapshot) {
      if (typeof value === 'undefined') delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function whoami(headers: Record<string, string>): Promise<string | null> {
  const app = express();
  app.use(attachUserId);
  app.get('/whoami', (request, response) => response.json({ userId: request.userId ?? null }));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Test server did not provide a usable address');
  }
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/whoami`, { headers });
    return ((await res.json()) as { userId: string | null }).userId;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('a valid shared key + X-User-Id acts as that user (service principal)', async () => {
  const restore = snapshotEnv(['API_SHARED_SECRET']);
  process.env.API_SHARED_SECRET = 'svc-secret';
  try {
    const userId = await whoami({ 'X-API-Key': 'svc-secret', 'X-User-Id': 'u_mcp' });
    assert.equal(userId, 'u_mcp');
  } finally {
    restore();
  }
});

test('the service path requires both the key and X-User-Id', async () => {
  const restore = snapshotEnv(['API_SHARED_SECRET']);
  process.env.API_SHARED_SECRET = 'svc-secret';
  try {
    // Valid key but no X-User-Id → the service-auth branch is skipped and we fall through
    // to the normal resolution (the dev default, since Clerk is off in tests) rather than
    // erroring or acting as an empty user.
    const userId = await whoami({ 'X-API-Key': 'svc-secret' });
    assert.equal(userId, 'user_local_dev');
  } finally {
    restore();
  }
});

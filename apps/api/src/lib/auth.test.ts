import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { assertProductionAuthConfigured, attachUserId } from './auth';

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

test('production with Clerk disabled ignores X-User-Id (fail closed)', async () => {
  const restore = snapshotEnv(['NODE_ENV', 'CLERK_SECRET_KEY', 'WEBSITE_SITE_NAME', 'API_SHARED_SECRET']);
  process.env.NODE_ENV = 'production';
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.WEBSITE_SITE_NAME;
  delete process.env.API_SHARED_SECRET;
  try {
    // A misconfigured prod deploy (no Clerk) must NOT let an anonymous caller pick an identity.
    const userId = await whoami({ 'X-User-Id': 'u_attacker' });
    assert.equal(userId, null);
  } finally {
    restore();
  }
});

test('outside production, X-User-Id still resolves the dev user', async () => {
  const restore = snapshotEnv(['NODE_ENV', 'CLERK_SECRET_KEY', 'WEBSITE_SITE_NAME']);
  delete process.env.NODE_ENV;
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.WEBSITE_SITE_NAME;
  try {
    const userId = await whoami({ 'X-User-Id': 'u_dev' });
    assert.equal(userId, 'u_dev');
  } finally {
    restore();
  }
});

test('assertProductionAuthConfigured throws when production and Clerk is unconfigured', () => {
  const restore = snapshotEnv(['NODE_ENV', 'CLERK_SECRET_KEY', 'WEBSITE_SITE_NAME']);
  process.env.NODE_ENV = 'production';
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.WEBSITE_SITE_NAME;
  try {
    assert.throws(() => assertProductionAuthConfigured(), /CLERK_SECRET_KEY/);
  } finally {
    restore();
  }
});

test('assertProductionAuthConfigured is a no-op in local development', () => {
  const restore = snapshotEnv(['NODE_ENV', 'CLERK_SECRET_KEY', 'WEBSITE_SITE_NAME']);
  delete process.env.NODE_ENV;
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.WEBSITE_SITE_NAME;
  try {
    assert.doesNotThrow(() => assertProductionAuthConfigured());
  } finally {
    restore();
  }
});

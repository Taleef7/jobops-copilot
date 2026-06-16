import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createDiscoveryRouter, createDiscoverySweepRouter } from './discovery';
import { createSavedSearchesRouter } from './saved-searches';
import type { DiscoveryResult } from '@/lib/discovery';
import type { SavedSearch } from '@/types';

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

async function withServer(mount: (app: express.Express) => void, run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  // Mimic the dev-mode user resolution: trust X-User-Id for tests.
  app.use((request, _response, next) => {
    const header = request.header('X-User-Id');
    if (header) request.userId = header.trim();
    next();
  });
  mount(app);

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

test('POST /api/discovery/run requires a signed-in user', async () => {
  const router = createDiscoveryRouter({
    runDiscovery: async () => ({ inserted: 0, skipped: 0, source: 'remotive' }),
    listUsersWithSavedSearches: async () => [],
  });
  await withServer(
    (app) => app.use('/api/discovery', router),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/discovery/run`, { method: 'POST' });
      assert.equal(response.status, 401);
    },
  );
});

test('POST /api/discovery/run runs discovery for the request user', async () => {
  const router = createDiscoveryRouter({
    runDiscovery: async (userId) => {
      assert.equal(userId, 'user_test');
      return { inserted: 2, skipped: 1, source: 'adzuna' };
    },
    listUsersWithSavedSearches: async () => [],
  });
  await withServer(
    (app) => app.use('/api/discovery', router),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/discovery/run`, {
        method: 'POST',
        headers: { 'X-User-Id': 'user_test' },
      });
      assert.equal(response.status, 200);
      const data = (await response.json()) as DiscoveryResult;
      assert.equal(data.inserted, 2);
      assert.equal(data.skipped, 1);
      assert.equal(data.source, 'adzuna');
    },
  );
});

test('saved-search routes are user-scoped CRUD', async () => {
  const store: SavedSearch[] = [];
  const router = createSavedSearchesRouter({
    listSavedSearches: async (userId) => store.filter((entry) => entry.userId === userId),
    createSavedSearch: async (userId, body) => {
      const saved: SavedSearch = {
        id: 's1',
        userId,
        query: body.query,
        location: body.location,
        remoteOnly: Boolean(body.remoteOnly),
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      };
      store.push(saved);
      return saved;
    },
    deleteSavedSearch: async (userId, id) => {
      const index = store.findIndex((entry) => entry.id === id && entry.userId === userId);
      if (index < 0) return false;
      store.splice(index, 1);
      return true;
    },
  });

  await withServer(
    (app) => app.use('/api/saved-searches', router),
    async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/saved-searches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user_test' },
        body: JSON.stringify({ query: 'ai engineer' }),
      });
      assert.equal(created.status, 201);

      const listed = await fetch(`${baseUrl}/api/saved-searches`, { headers: { 'X-User-Id': 'user_test' } });
      const data = (await listed.json()) as { savedSearches: SavedSearch[] };
      assert.equal(data.savedSearches.length, 1);

      // Another user sees nothing.
      const otherList = await fetch(`${baseUrl}/api/saved-searches`, { headers: { 'X-User-Id': 'user_other' } });
      assert.equal(((await otherList.json()) as { savedSearches: SavedSearch[] }).savedSearches.length, 0);

      const removed = await fetch(`${baseUrl}/api/saved-searches/s1`, {
        method: 'DELETE',
        headers: { 'X-User-Id': 'user_test' },
      });
      assert.equal(removed.status, 204);
    },
  );
});

test('POST /api/n8n/discover is guarded by the n8n webhook secret', async () => {
  const restore = snapshotEnv(['N8N_WEBHOOK_SECRET']);
  process.env.N8N_WEBHOOK_SECRET = 'n8n-secret';
  try {
    const router = createDiscoverySweepRouter({
      runDiscovery: async () => ({ inserted: 1, skipped: 0, source: 'remotive' }),
      listUsersWithSavedSearches: async () => ['u1', 'u2'],
    });
    await withServer(
      (app) => app.use('/api/n8n/discover', router),
      async (baseUrl) => {
        const rejected = await fetch(`${baseUrl}/api/n8n/discover`, { method: 'POST' });
        assert.equal(rejected.status, 401);

        const accepted = await fetch(`${baseUrl}/api/n8n/discover`, {
          method: 'POST',
          headers: { 'X-N8N-Webhook-Secret': 'n8n-secret' },
        });
        assert.equal(accepted.status, 200);
        const data = (await accepted.json()) as { users: number; inserted: number };
        assert.equal(data.users, 2);
        assert.equal(data.inserted, 2);
      },
    );
  } finally {
    restore();
  }
});

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createApp } from '@/app';
import { createInternalRouter } from './internal';

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

test('POST /internal/discovery/run and /internal/liveness/run return 503 when N8N_WEBHOOK_SECRET is unset', async () => {
  const restore = snapshotEnv(['N8N_WEBHOOK_SECRET']);
  delete process.env.N8N_WEBHOOK_SECRET;

  try {
    const router = createInternalRouter({
      discovery: {
        runDiscovery: async () => ({ inserted: 0, skipped: 0, source: 'test' }),
        listUsersWithSavedSearches: async () => [],
      },
      liveness: {
        fetchPage: async () => ({ html: '<html>ok</html>' }),
        listCandidates: async () => [],
      },
    });

    await withServer(
      (app) => app.use('/internal', router),
      async (baseUrl) => {
        const resDisc = await fetch(`${baseUrl}/internal/discovery/run`, { method: 'POST' });
        assert.equal(resDisc.status, 503);

        const resLive = await fetch(`${baseUrl}/internal/liveness/run`, { method: 'POST' });
        assert.equal(resLive.status, 503);

        const resDigest = await fetch(`${baseUrl}/internal/digest/run`, { method: 'POST' });
        assert.equal(resDigest.status, 503);
      },
    );
  } finally {
    restore();
  }
});

test('POST /internal/discovery/run and /internal/liveness/run return 401 when X-N8N-Webhook-Secret is invalid', async () => {
  const restore = snapshotEnv(['N8N_WEBHOOK_SECRET']);
  process.env.N8N_WEBHOOK_SECRET = 'correct-secret';

  try {
    const router = createInternalRouter({
      discovery: {
        runDiscovery: async () => ({ inserted: 0, skipped: 0, source: 'test' }),
        listUsersWithSavedSearches: async () => [],
      },
      liveness: {
        fetchPage: async () => ({ html: '<html>ok</html>' }),
        listCandidates: async () => [],
      },
    });

    await withServer(
      (app) => app.use('/internal', router),
      async (baseUrl) => {
        const resNoHeader = await fetch(`${baseUrl}/internal/discovery/run`, { method: 'POST' });
        assert.equal(resNoHeader.status, 401);

        const resWrongHeader = await fetch(`${baseUrl}/internal/discovery/run`, {
          method: 'POST',
          headers: { 'X-N8N-Webhook-Secret': 'wrong-secret' },
        });
        assert.equal(resWrongHeader.status, 401);

        const resLiveWrong = await fetch(`${baseUrl}/internal/liveness/run`, {
          method: 'POST',
          headers: { 'X-N8N-Webhook-Secret': 'wrong-secret' },
        });
        assert.equal(resLiveWrong.status, 401);
      },
    );
  } finally {
    restore();
  }
});

test('POST /internal/discovery/run and /internal/liveness/run return 200 with valid secret', async () => {
  const restore = snapshotEnv(['N8N_WEBHOOK_SECRET']);
  process.env.N8N_WEBHOOK_SECRET = 'correct-secret';

  try {
    const router = createInternalRouter({
      discovery: {
        runDiscovery: async () => ({ inserted: 1, skipped: 2, source: 'adzuna' }),
        listUsersWithSavedSearches: async () => ['user_1'],
      },
      liveness: {
        fetchPage: async () => ({ html: '<html>ok</html>' }),
        listCandidates: async () => [{ id: 'job_1', jobUrl: 'https://example.com' }],
        updateJobLiveness: async () => {},
      },
      digest: {
        generateDailyDigest: async (userId: string) => ({
          id: 'notif-mock-1',
          userId,
          kind: 'digest',
          title: 'Daily Digest',
          body: 'Summary',
          jobId: null,
          dedupeKey: 'daily_digest:user_1:2026-09-22',
          channels: { in_app: { status: 'sent' } },
          readAt: null,
          createdAt: new Date().toISOString(),
        }),
        listUsersForDigest: async () => [
          {
            userId: 'user_1',
            settings: {
              channels: { in_app: true, email: true, telegram: false, web_push: false },
              minMatchScore: 80,
              digestHour: 9,
              quietHours: { enabled: false, start: '22:00', end: '08:00' },
            },
          },
        ],
      },
    });

    await withServer(
      (app) => app.use('/internal', router),
      async (baseUrl) => {
        const resDisc = await fetch(`${baseUrl}/internal/discovery/run`, {
          method: 'POST',
          headers: { 'X-N8N-Webhook-Secret': 'correct-secret' },
        });
        assert.equal(resDisc.status, 200);
        const discBody = (await resDisc.json()) as { workflow: string; inserted: number };
        assert.equal(discBody.workflow, 'discover');
        assert.equal(discBody.inserted, 1);

        const resLive = await fetch(`${baseUrl}/internal/liveness/run`, {
          method: 'POST',
          headers: { 'X-N8N-Webhook-Secret': 'correct-secret' },
        });
        assert.equal(resLive.status, 200);
        const liveBody = (await resLive.json()) as { workflow: string; checked: number };
        assert.equal(liveBody.workflow, 'liveness');
        assert.equal(liveBody.checked, 1);

        const resDigest = await fetch(`${baseUrl}/internal/digest/run?force=true`, {
          method: 'POST',
          headers: { 'X-N8N-Webhook-Secret': 'correct-secret' },
        });
        assert.equal(resDigest.status, 200);
        const digestBody = (await resDigest.json()) as { workflow: string; dispatched: number };
        assert.equal(digestBody.workflow, 'digest');
        assert.equal(digestBody.dispatched, 1);
      },
    );
  } finally {
    restore();
  }
});

test('app-level test: POST /internal/discovery/run carrying X-N8N-Webhook-Secret without X-API-Key passes requireSharedApiKey', async () => {
  const restore = snapshotEnv(['API_SHARED_SECRET', 'N8N_WEBHOOK_SECRET', 'DATABASE_URL']);
  process.env.API_SHARED_SECRET = 'shared-secret';
  process.env.N8N_WEBHOOK_SECRET = 'n8n-secret';
  delete process.env.DATABASE_URL;

  try {
    const app = createApp({
      runLimiter: (_req, _res, next) => next(),
      runBudget: (_req, _res, next) => next(),
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw new Error('Test server did not provide a usable address');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      // With invalid secret, should fail with 401 from requireN8nWebhookSecret, NOT 401 from requireSharedApiKey
      // With valid secret, should pass requireSharedApiKey and hit the internal router (returning 200)
      const res = await fetch(`${baseUrl}/internal/discovery/run`, {
        method: 'POST',
        headers: {
          'X-N8N-Webhook-Secret': 'n8n-secret',
          // NO X-API-Key header!
        },
      });

      assert.equal(res.status, 200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    restore();
  }
});

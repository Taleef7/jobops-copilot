import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import express from 'express';
import { _resetPushSubscriptionStoreForTests } from '@/data/push-subscription-store';
import { pushRouter } from './push';

const TEST_USER = 'user_push_routes_test';

async function withServer(
  mount: (app: express.Express) => void,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = TEST_USER;
    next();
  });
  mount(app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Test server address unavailable');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('Push routes: vapid-key, subscribe, list, and unsubscribe', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-push-routes-test-'));
  const prevEnv = { ...process.env };

  try {
    process.chdir(tempDir);
    await _resetPushSubscriptionStoreForTests([]);
    process.env.VAPID_PUBLIC_KEY = 'test-public-vapid-key-xyz';

    await withServer(
      (app) => app.use('/api', pushRouter),
      async (baseUrl) => {
        // 1. GET /api/push/vapid-key
        const vapidRes = await fetch(`${baseUrl}/api/push/vapid-key`);
        assert.equal(vapidRes.status, 200);
        const vapidData = (await vapidRes.json()) as { publicKey: string };
        assert.equal(vapidData.publicKey, 'test-public-vapid-key-xyz');

        // 2. POST /api/push/subscribe validation error
        const badSubRes = await fetch(`${baseUrl}/api/push/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: { endpoint: 'not-https' } }),
        });
        assert.equal(badSubRes.status, 400);

        // 3. POST /api/push/subscribe valid
        const goodSubRes = await fetch(`${baseUrl}/api/push/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: {
              endpoint: 'https://push.example.com/endpoint/12345',
              keys: {
                p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9Ac',
                auth: 'tBHItJI5svbpez7KI4CCXg',
              },
            },
            userAgent: 'Chrome 120 macOS',
          }),
        });
        assert.equal(goodSubRes.status, 201);
        const goodSubData = (await goodSubRes.json()) as {
          success: boolean;
          subscription: { endpoint: string };
        };
        assert.equal(goodSubData.success, true);
        assert.equal(goodSubData.subscription.endpoint, 'https://push.example.com/endpoint/12345');

        // 4. GET /api/push/subscriptions
        const listRes = await fetch(`${baseUrl}/api/push/subscriptions`);
        assert.equal(listRes.status, 200);
        const listData = (await listRes.json()) as {
          subscriptions: Array<{ endpoint: string }>;
        };
        assert.equal(listData.subscriptions.length, 1);
        assert.equal(listData.subscriptions[0]!.endpoint, 'https://push.example.com/endpoint/12345');

        // 5. DELETE /api/push/subscribe
        const deleteRes = await fetch(`${baseUrl}/api/push/subscribe`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: 'https://push.example.com/endpoint/12345' }),
        });
        assert.equal(deleteRes.status, 200);

        // 6. Verify empty after delete
        const listAfterDelete = await fetch(`${baseUrl}/api/push/subscriptions`);
        const listAfterData = (await listAfterDelete.json()) as {
          subscriptions: Array<{ endpoint: string }>;
        };
        assert.equal(listAfterData.subscriptions.length, 0);
      },
    );
  } finally {
    process.env = prevEnv;
    process.chdir(originalCwd);
  }
});

import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import webpush from 'web-push';
import {
  _resetPushSubscriptionStoreForTests,
  listPushSubscriptions,
  upsertPushSubscription,
} from '@/data/push-subscription-store';
import { WebPushChannelAdapter } from './web-push';
import type { NotificationSettings } from '@/types';

const defaultSettings: NotificationSettings = {
  channels: { in_app: true, email: false, telegram: false, web_push: true },
  minMatchScore: 80,
  digestHour: 9,
  quietHours: { enabled: false, start: '22:00', end: '08:00' },
};

const TEST_USER = 'user_web_push_test';

test('WebPushChannelAdapter lifecycle, VAPID sending, and auto-pruning expired subscriptions', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-web-push-test-'));

  const originalSendNotification = webpush.sendNotification;
  const originalSetVapidDetails = webpush.setVapidDetails;
  const prevEnv = { ...process.env };

  try {
    process.chdir(tempDir);
    await _resetPushSubscriptionStoreForTests([]);

    process.env.VAPID_PUBLIC_KEY = 'test-vapid-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-vapid-private-key';
    process.env.VAPID_SUBJECT = 'mailto:test@jobops.dev';
    process.env.NODE_ENV = 'production'; // test real branch logic

    const adapter = new WebPushChannelAdapter();
    assert.equal(adapter.isConfigured(defaultSettings), true);

    // 1. Send with no subscriptions returns skipped
    const skippedResult = await adapter.send(TEST_USER, {
      kind: 'job_match',
      title: 'Senior Distributed Engineer',
      body: '94% match at Snowflake',
      matchScore: 94,
      jobId: 'job-snowflake-1',
    }, defaultSettings);

    assert.equal(skippedResult.status, 'skipped');
    assert.match(skippedResult.error || '', /No active web push subscriptions/i);

    // 2. Add an active subscription
    await upsertPushSubscription(TEST_USER, {
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/sub-1',
      keys: {
        p256dh: 'test-p256dh',
        auth: 'test-auth',
      },
    });

    let sentPayload: string | undefined;
    let sendCount = 0;

    (webpush as unknown as { sendNotification: typeof webpush.sendNotification }).sendNotification = (async (_sub: unknown, payload?: string) => {
      sendCount += 1;
      sentPayload = payload;
      return { statusCode: 201 };
    }) as unknown as typeof webpush.sendNotification;

    (webpush as unknown as { setVapidDetails: typeof webpush.setVapidDetails }).setVapidDetails = () => {};

    // 3. Send notification successfully
    const successResult = await adapter.send(TEST_USER, {
      kind: 'job_match',
      title: 'Senior Distributed Engineer',
      body: '94% match at Snowflake',
      matchScore: 94,
      jobId: 'job-snowflake-1',
    }, defaultSettings);

    assert.equal(successResult.status, 'sent');
    assert.ok(successResult.sentAt);
    assert.equal(sendCount, 1);
    assert.ok(sentPayload);
    const parsedData = JSON.parse(sentPayload as string);
    assert.equal(parsedData.title, 'Senior Distributed Engineer');
    assert.equal(parsedData.data?.url, '/jobs/job-snowflake-1');
    assert.equal(parsedData.data?.matchScore, 94);

    // 4. Auto-pruning on 410 Gone / expired subscription
    (webpush as unknown as { sendNotification: typeof webpush.sendNotification }).sendNotification = (async () => {
      const error = new Error('subscription expired') as Error & { statusCode: number };
      error.statusCode = 410;
      throw error;
    }) as unknown as typeof webpush.sendNotification;

    const failedResult = await adapter.send(TEST_USER, {
      kind: 'digest',
      title: 'Daily Digest',
      body: 'Summary',
    }, defaultSettings);

    assert.equal(failedResult.status, 'failed');
    // Subscription should be pruned from store
    const remaining = await listPushSubscriptions(TEST_USER);
    assert.equal(remaining.length, 0);
  } finally {
    webpush.sendNotification = originalSendNotification;
    webpush.setVapidDetails = originalSetVapidDetails;
    process.env = prevEnv;
    process.chdir(originalCwd);
  }
});

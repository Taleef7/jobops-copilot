import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  _resetPushSubscriptionStoreForTests,
  deletePushSubscription,
  deletePushSubscriptionByEndpoint,
  listPushSubscriptions,
  upsertPushSubscription,
} from './push-subscription-store';

const USER_A = 'user_push_store_a';
const USER_B = 'user_push_store_b';

test('push subscription store CRUD and multi-tenant isolation', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-push-store-test-'));

  try {
    process.chdir(tempDir);
    await _resetPushSubscriptionStoreForTests([]);

    // 1. Initial list is empty
    assert.deepEqual(await listPushSubscriptions(USER_A), []);

    // 2. Upsert subscription for USER_A
    const sub1 = await upsertPushSubscription(USER_A, {
      endpoint: 'https://fcm.googleapis.com/fcm/send/endpoint-user-a-1',
      keys: {
        p256dh: 'test-p256dh-key-1',
        auth: 'test-auth-key-1',
      },
      userAgent: 'Mozilla/5.0 Chrome/120',
    });

    assert.equal(sub1.userId, USER_A);
    assert.equal(sub1.endpoint, 'https://fcm.googleapis.com/fcm/send/endpoint-user-a-1');
    assert.equal(sub1.p256dh, 'test-p256dh-key-1');

    // 3. Upsert subscription for USER_B
    await upsertPushSubscription(USER_B, {
      endpoint: 'https://fcm.googleapis.com/fcm/send/endpoint-user-b-1',
      keys: {
        p256dh: 'test-p256dh-b',
        auth: 'test-auth-b',
      },
    });

    // 4. Isolation: USER_A has 1, USER_B has 1
    const listA = await listPushSubscriptions(USER_A);
    const listB = await listPushSubscriptions(USER_B);
    assert.equal(listA.length, 1);
    assert.equal(listB.length, 1);
    assert.equal(listA[0]!.endpoint, sub1.endpoint);

    // 5. Updating existing endpoint updates keys without duplicate row
    const updated = await upsertPushSubscription(USER_A, {
      endpoint: 'https://fcm.googleapis.com/fcm/send/endpoint-user-a-1',
      keys: {
        p256dh: 'test-p256dh-key-1-rotated',
        auth: 'test-auth-key-1-rotated',
      },
    });
    assert.equal(updated.p256dh, 'test-p256dh-key-1-rotated');
    const listAAfterUpdate = await listPushSubscriptions(USER_A);
    assert.equal(listAAfterUpdate.length, 1);

    // 6. Delete subscription by user and endpoint
    const deleted = await deletePushSubscription(USER_A, sub1.endpoint);
    assert.equal(deleted, true);
    assert.deepEqual(await listPushSubscriptions(USER_A), []);

    // 7. Delete subscription by endpoint (pruning)
    const deletedByEndpoint = await deletePushSubscriptionByEndpoint(
      'https://fcm.googleapis.com/fcm/send/endpoint-user-b-1',
    );
    assert.equal(deletedByEndpoint, true);
    assert.deepEqual(await listPushSubscriptions(USER_B), []);
  } finally {
    process.chdir(originalCwd);
  }
});

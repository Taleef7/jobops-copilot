import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  _resetNotificationStoreForTests,
  countUnreadNotifications,
  getNotificationById,
  getNotificationByDedupeKey,
  getNotificationSettings,
  insertNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationChannels,
  updateNotificationSettings,
} from './notification-store';

const USER_A = 'user_notif_test_a';
const USER_B = 'user_notif_test_b';

test('notification-store CRUD, deduplication, unread counts, and tenant isolation', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-notif-store-test-'));

  try {
    process.chdir(tempDir);
    await _resetNotificationStoreForTests([], {});

    // 1. Insert notification for USER_A
    const notif1 = await insertNotification(USER_A, {
      kind: 'job_match',
      title: 'High Fit Match: AI Engineer',
      body: 'Northwind Labs posted AI Automation Engineer (91% match)',
      jobId: 'job-123',
      dedupeKey: 'job_match:job-123',
    });

    assert.ok(notif1.id);
    assert.equal(notif1.userId, USER_A);
    assert.equal(notif1.kind, 'job_match');
    assert.equal(notif1.title, 'High Fit Match: AI Engineer');
    assert.equal(notif1.channels.in_app?.status, 'sent');
    assert.equal(notif1.readAt, undefined);

    // 2. DedupeKey idempotency
    const dupNotif = await insertNotification(USER_A, {
      kind: 'job_match',
      title: 'Different Title',
      body: 'Different Body',
      dedupeKey: 'job_match:job-123',
    });
    assert.equal(dupNotif.id, notif1.id);

    // 3. Lookup by id and by dedupeKey
    const byId = await getNotificationById(USER_A, notif1.id);
    assert.equal(byId?.id, notif1.id);

    const byDedupe = await getNotificationByDedupeKey('job_match:job-123');
    assert.equal(byDedupe?.id, notif1.id);

    // 4. Cross-tenant isolation
    const notifB = await insertNotification(USER_B, {
      kind: 'follow_up',
      title: 'Follow-up Due',
      body: 'Time to follow up with recruiter at AtlasHire',
      dedupeKey: 'follow_up:job-456',
    });
    assert.notEqual(notifB.id, notif1.id);

    const userBfromA = await getNotificationById(USER_A, notifB.id);
    assert.equal(userBfromA, undefined);

    // 5. Unread count and listing
    assert.equal(await countUnreadNotifications(USER_A), 1);
    assert.equal(await countUnreadNotifications(USER_B), 1);

    const listA = await listNotifications(USER_A);
    assert.equal(listA.length, 1);
    assert.equal(listA[0]?.id, notif1.id);

    // 6. Mark read
    const readItem = await markNotificationRead(USER_A, notif1.id);
    assert.ok(readItem?.readAt);
    assert.equal(await countUnreadNotifications(USER_A), 0);

    const unreadListA = await listNotifications(USER_A, { unreadOnly: true });
    assert.equal(unreadListA.length, 0);

    // 7. Mark all read
    const notifA2 = await insertNotification(USER_A, {
      kind: 'digest',
      title: 'Daily Digest',
      body: '3 new matches today',
    });
    assert.equal(await countUnreadNotifications(USER_A), 1);

    const markedCount = await markAllNotificationsRead(USER_A);
    assert.equal(markedCount, 1);
    assert.equal(await countUnreadNotifications(USER_A), 0);

    // 8. Update notification channels
    const updatedChannels = await updateNotificationChannels(notifA2.id, {
      telegram: { status: 'sent', sentAt: new Date().toISOString() },
    });
    assert.equal(updatedChannels?.channels.telegram?.status, 'sent');
    assert.equal(updatedChannels?.channels.in_app?.status, 'sent');

    // 9. Notification settings
    const defaultSettings = await getNotificationSettings(USER_A);
    assert.equal(defaultSettings.channels.in_app, true);
    assert.equal(defaultSettings.channels.telegram, false);
    assert.equal(defaultSettings.minMatchScore, 80);

    const updatedSettings = await updateNotificationSettings(USER_A, {
      channels: { in_app: true, email: true, telegram: true, web_push: false },
      minMatchScore: 85,
      telegramChatId: '123456789',
    });
    assert.equal(updatedSettings.channels.telegram, true);
    assert.equal(updatedSettings.minMatchScore, 85);
    assert.equal(updatedSettings.telegramChatId, '123456789');

    const fetchedSettings = await getNotificationSettings(USER_A);
    assert.equal(fetchedSettings.minMatchScore, 85);
    assert.equal(fetchedSettings.telegramChatId, '123456789');
  } finally {
    process.chdir(originalCwd);
  }
});

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '@/app';
import { _resetNotificationStoreForTests } from '@/data/notification-store';
import type { NotificationRecord, NotificationSettings } from '@/types';

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = createApp();
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
}

const USER_A = 'user_notif_route_a';
const USER_B = 'user_notif_route_b';

function hdrs(userId?: string) {
  return {
    'Content-Type': 'application/json',
    ...(userId ? { 'X-User-Id': userId } : {}),
  };
}

test('notifications API route lifecycle, read management, settings, and cross-tenant isolation', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-notif-routes-test-'));

  try {
    process.chdir(tempDir);
    await _resetNotificationStoreForTests([], {});

    await withServer(async (baseUrl) => {
      // 1. Initial list for USER_A is empty
      const listRes0 = await fetch(`${baseUrl}/api/notifications`, { headers: hdrs(USER_A) });
      assert.equal(listRes0.status, 200);
      const listData0 = (await listRes0.json()) as { notifications: NotificationRecord[]; unreadCount: number };
      assert.equal(listData0.notifications.length, 0);
      assert.equal(listData0.unreadCount, 0);

      // 2. Dispatch a test notification
      const testRes = await fetch(`${baseUrl}/api/notifications/test`, {
        method: 'POST',
        headers: hdrs(USER_A),
      });
      assert.equal(testRes.status, 200);
      const testData = (await testRes.json()) as { notification: NotificationRecord };
      assert.ok(testData.notification.id);
      assert.equal(testData.notification.userId, USER_A);
      assert.equal(testData.notification.channels.in_app?.status, 'sent');
      const notif1Id = testData.notification.id;

      // 3. List shows 1 notification, unreadCount 1
      const listRes1 = await fetch(`${baseUrl}/api/notifications`, { headers: hdrs(USER_A) });
      const listData1 = (await listRes1.json()) as { notifications: NotificationRecord[]; unreadCount: number };
      assert.equal(listData1.notifications.length, 1);
      assert.equal(listData1.unreadCount, 1);

      // 4. Mark specific notification read
      const markRes = await fetch(`${baseUrl}/api/notifications/${notif1Id}/read`, {
        method: 'POST',
        headers: hdrs(USER_A),
      });
      assert.equal(markRes.status, 200);
      const markData = (await markRes.json()) as { notification: NotificationRecord };
      assert.ok(markData.notification.readAt);

      // 5. Unread filter returns 0
      const unreadRes = await fetch(`${baseUrl}/api/notifications?unreadOnly=true`, { headers: hdrs(USER_A) });
      const unreadData = (await unreadRes.json()) as { notifications: NotificationRecord[]; unreadCount: number };
      assert.equal(unreadData.notifications.length, 0);
      assert.equal(unreadData.unreadCount, 0);

      // 6. Cross-tenant isolation: USER_B cannot see or mark read USER_A's notification
      const userBList = await fetch(`${baseUrl}/api/notifications`, { headers: hdrs(USER_B) });
      const userBListData = (await userBList.json()) as { notifications: NotificationRecord[]; unreadCount: number };
      assert.equal(userBListData.notifications.length, 0);

      const userBMark = await fetch(`${baseUrl}/api/notifications/${notif1Id}/read`, {
        method: 'POST',
        headers: hdrs(USER_B),
      });
      assert.equal(userBMark.status, 404);

      // 7. Mark all read
      await fetch(`${baseUrl}/api/notifications/test`, { method: 'POST', headers: hdrs(USER_A) });
      await fetch(`${baseUrl}/api/notifications/test`, { method: 'POST', headers: hdrs(USER_A) });

      const beforeAllRes = await fetch(`${baseUrl}/api/notifications`, { headers: hdrs(USER_A) });
      const beforeAllData = (await beforeAllRes.json()) as { notifications: NotificationRecord[]; unreadCount: number };
      assert.equal(beforeAllData.unreadCount, 2);

      const readAllRes = await fetch(`${baseUrl}/api/notifications/read-all`, {
        method: 'POST',
        headers: hdrs(USER_A),
      });
      assert.equal(readAllRes.status, 200);
      const readAllData = (await readAllRes.json()) as { markedCount: number };
      assert.equal(readAllData.markedCount, 2);

      const afterAllRes = await fetch(`${baseUrl}/api/notifications`, { headers: hdrs(USER_A) });
      const afterAllData = (await afterAllRes.json()) as { notifications: NotificationRecord[]; unreadCount: number };
      assert.equal(afterAllData.unreadCount, 0);

      // 8. Notification settings GET & PUT
      const settingsGet = await fetch(`${baseUrl}/api/notification-settings`, { headers: hdrs(USER_A) });
      assert.equal(settingsGet.status, 200);
      const settingsGetData = (await settingsGet.json()) as { settings: NotificationSettings };
      assert.equal(settingsGetData.settings.channels.in_app, true);
      assert.equal(settingsGetData.settings.minMatchScore, 80);

      const settingsPut = await fetch(`${baseUrl}/api/notification-settings`, {
        method: 'PUT',
        headers: hdrs(USER_A),
        body: JSON.stringify({
          channels: { in_app: true, email: true, telegram: true, web_push: false },
          minMatchScore: 90,
          telegramChatId: 'chat-445566',
          quietHours: { enabled: true, start: '23:00', end: '07:00' },
        }),
      });
      assert.equal(settingsPut.status, 200);
      const settingsPutData = (await settingsPut.json()) as { settings: NotificationSettings };
      assert.equal(settingsPutData.settings.minMatchScore, 90);
      assert.equal(settingsPutData.settings.telegramChatId, 'chat-445566');
      assert.equal(settingsPutData.settings.quietHours.enabled, true);
      assert.equal(settingsPutData.settings.quietHours.start, '23:00');

      // 9. Validation error handling for settings
      const invalidScoreRes = await fetch(`${baseUrl}/api/notification-settings`, {
        method: 'PUT',
        headers: hdrs(USER_A),
        body: JSON.stringify({ minMatchScore: 150 }),
      });
      assert.equal(invalidScoreRes.status, 400);
    });
  } finally {
    process.chdir(originalCwd);
  }
});

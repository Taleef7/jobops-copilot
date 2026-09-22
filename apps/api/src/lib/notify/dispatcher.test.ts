import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  _resetNotificationStoreForTests,
  updateNotificationSettings,
} from '../../data/notification-store';
import {
  clearRegisteredAdapters,
  dispatchNotification,
  dispatchTestNotification,
  isWithinQuietHours,
  registerChannelAdapter,
} from './dispatcher';
import type { NotificationChannelAdapter } from './types';

const TEST_USER = 'user_dispatcher_test';

test('isWithinQuietHours logic for standard and cross-midnight windows', () => {
  // 1. Disabled
  assert.equal(
    isWithinQuietHours({ enabled: false, start: '22:00', end: '08:00' }, new Date('2026-05-15T23:30:00')),
    false,
  );

  // 2. Cross-midnight window (22:00 to 08:00)
  const qhOvernight = { enabled: true, start: '22:00', end: '08:00' };

  // 23:30 -> inside (true)
  const at2330 = new Date('2026-05-15T23:30:00');
  assert.equal(isWithinQuietHours(qhOvernight, at2330), true);

  // 04:15 -> inside (true)
  const at0415 = new Date('2026-05-15T04:15:00');
  assert.equal(isWithinQuietHours(qhOvernight, at0415), true);

  // 12:00 -> outside (false)
  const at1200 = new Date('2026-05-15T12:00:00');
  assert.equal(isWithinQuietHours(qhOvernight, at1200), false);

  // 3. Same-day window (13:00 to 15:00)
  const qhSameDay = { enabled: true, start: '13:00', end: '15:00' };
  const at1400 = new Date('2026-05-15T14:00:00');
  const at1600 = new Date('2026-05-15T16:00:00');
  assert.equal(isWithinQuietHours(qhSameDay, at1400), true);
  assert.equal(isWithinQuietHours(qhSameDay, at1600), false);
});

test('dispatcher creates in-app notification and coordinates channel adapters', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-dispatcher-test-'));

  try {
    process.chdir(tempDir);
    await _resetNotificationStoreForTests([], {});
    clearRegisteredAdapters();

    let adapterCalled = false;
    let lastPayloadTitle = '';

    const mockTelegramAdapter: NotificationChannelAdapter = {
      name: 'telegram',
      isConfigured: (settings) => Boolean(settings.telegramChatId),
      send: async (_userId, payload) => {
        adapterCalled = true;
        lastPayloadTitle = payload.title;
        return { status: 'sent', sentAt: new Date().toISOString() };
      },
    };

    registerChannelAdapter(mockTelegramAdapter);

    // 1. Initial dispatch with telegram disabled by default
    const notif1 = await dispatchNotification(TEST_USER, {
      kind: 'job_match',
      title: 'Senior Engineer at Stripe',
      body: '94% match for Senior Distributed Systems',
      matchScore: 94,
    });

    assert.equal(notif1.channels.in_app?.status, 'sent');
    assert.equal(notif1.channels.telegram?.status, 'skipped');
    assert.match(notif1.channels.telegram?.error || '', /disabled/i);
    assert.equal(adapterCalled, false);

    // 2. Enable telegram channel and configure chatId
    await updateNotificationSettings(TEST_USER, {
      channels: { in_app: true, email: false, telegram: true, web_push: false },
      telegramChatId: 'telegram-chat-999',
      minMatchScore: 85,
    });

    const notif2 = await dispatchNotification(TEST_USER, {
      kind: 'job_match',
      title: 'Staff Engineer at OpenAI',
      body: '92% match for Staff Systems Engineer',
      matchScore: 92,
      dedupeKey: 'job_match:job-openai-1',
    });

    assert.equal(notif2.channels.in_app?.status, 'sent');
    assert.equal(notif2.channels.telegram?.status, 'sent');
    assert.equal(adapterCalled, true);
    assert.equal(lastPayloadTitle, 'Staff Engineer at OpenAI');

    // 3. Match score threshold check: score 80 < threshold 85
    adapterCalled = false;
    const notifLowScore = await dispatchNotification(TEST_USER, {
      kind: 'job_match',
      title: 'Junior QA at SmallCorp',
      body: '75% match',
      matchScore: 75,
    });

    assert.equal(notifLowScore.channels.in_app?.status, 'sent');
    assert.equal(notifLowScore.channels.telegram?.status, 'skipped');
    assert.match(notifLowScore.channels.telegram?.error || '', /below alert threshold/i);
    assert.equal(adapterCalled, false);

    // 4. Test notification helper
    const testNotif = await dispatchTestNotification(TEST_USER);
    assert.equal(testNotif.kind, 'approval_needed');
    assert.equal(testNotif.channels.in_app?.status, 'sent');
    assert.equal(testNotif.channels.telegram?.status, 'sent');
    assert.equal(adapterCalled, true);

    // 5. Adapter exception safety (never throws or blocks in_app)
    const faultAdapter: NotificationChannelAdapter = {
      name: 'email',
      isConfigured: () => true,
      send: async () => {
        throw new Error('SMTP connection timed out');
      },
    };
    registerChannelAdapter(faultAdapter);
    await updateNotificationSettings(TEST_USER, {
      channels: { in_app: true, email: true, telegram: true, web_push: false },
    });

    const faultNotif = await dispatchNotification(TEST_USER, {
      kind: 'agent_done',
      title: 'Research Brief Complete',
      body: 'Brief completed for Acme',
    });

    assert.equal(faultNotif.channels.in_app?.status, 'sent');
    assert.equal(faultNotif.channels.email?.status, 'failed');
    assert.match(faultNotif.channels.email?.error || '', /SMTP connection timed out/i);
    assert.equal(faultNotif.channels.telegram?.status, 'sent');
  } finally {
    clearRegisteredAdapters();
    process.chdir(originalCwd);
  }
});

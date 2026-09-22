import {
  getNotificationByDedupeKey,
  getNotificationSettings,
  insertNotification,
  updateNotificationChannels,
} from '@/data/notification-store';
import type {
  NotificationChannels,
  NotificationRecord,
  QuietHours,
} from '@/types';
import type {
  NotificationChannelAdapter,
  NotificationPayload,
} from '@/lib/notify/types';
import { telegramAdapter } from '@/lib/notify/telegram';
import { emailAdapter } from '@/lib/notify/email';
import { webPushAdapter } from '@/lib/notify/web-push';

const adapters = new Map<string, NotificationChannelAdapter>();
adapters.set(telegramAdapter.name, telegramAdapter);
adapters.set(emailAdapter.name, emailAdapter);
adapters.set(webPushAdapter.name, webPushAdapter);

export function registerChannelAdapter(adapter: NotificationChannelAdapter): void {
  adapters.set(adapter.name, adapter);
}

export function getRegisteredAdapters(): NotificationChannelAdapter[] {
  return Array.from(adapters.values());
}

export function clearRegisteredAdapters(): void {
  adapters.clear();
}

export function resetDefaultAdapters(): void {
  adapters.clear();
  adapters.set(telegramAdapter.name, telegramAdapter);
  adapters.set(emailAdapter.name, emailAdapter);
  adapters.set(webPushAdapter.name, webPushAdapter);
}

/**
 * Checks if current time is within user quiet hours.
 * Handles both standard windows (e.g. 13:00 to 15:00) and overnight windows (e.g. 22:00 to 08:00).
 */
export function isWithinQuietHours(quietHours: QuietHours, now: Date = new Date()): boolean {
  if (!quietHours.enabled) {
    return false;
  }

  const [startHourStr, startMinStr] = quietHours.start.split(':');
  const [endHourStr, endMinStr] = quietHours.end.split(':');

  if (!startHourStr || !startMinStr || !endHourStr || !endMinStr) {
    return false;
  }

  const startHour = parseInt(startHourStr, 10);
  const startMin = parseInt(startMinStr, 10);
  const endHour = parseInt(endHourStr, 10);
  const endMin = parseInt(endMinStr, 10);

  if (
    Number.isNaN(startHour) ||
    Number.isNaN(startMin) ||
    Number.isNaN(endHour) ||
    Number.isNaN(endMin)
  ) {
    return false;
  }

  const currentHour = now.getHours();
  const currentMin = now.getMinutes();
  const currentTotal = currentHour * 60 + currentMin;
  const startTotal = startHour * 60 + startMin;
  const endTotal = endHour * 60 + endMin;

  if (startTotal <= endTotal) {
    return currentTotal >= startTotal && currentTotal < endTotal;
  }

  // Cross-midnight window, e.g. 22:00 (1320) to 08:00 (480)
  return currentTotal >= startTotal || currentTotal < endTotal;
}

export async function dispatchNotification(
  userId: string,
  payload: NotificationPayload,
): Promise<NotificationRecord> {
  // 1. Idempotency check via dedupeKey
  if (payload.dedupeKey) {
    const existing = await getNotificationByDedupeKey(payload.dedupeKey);
    if (existing) {
      return existing;
    }
  }

  // 2. Fetch user notification preferences
  const settings = await getNotificationSettings(userId);
  const nowIso = new Date().toISOString();
  const inQuietHours = isWithinQuietHours(settings.quietHours);

  // 3. Setup channels ledger — in_app is always recorded and delivered immediately
  const channelsLedger: NotificationChannels = {
    in_app: {
      status: 'sent',
      sentAt: nowIso,
    },
  };

  // 4. Save notification record first (in-app inbox is the single source of truth)
  const record = await insertNotification(userId, {
    kind: payload.kind,
    title: payload.title,
    body: payload.body,
    jobId: payload.jobId,
    dedupeKey: payload.dedupeKey,
    channels: channelsLedger,
  });

  // 5. Fan out to registered external channel adapters
  const adapterList = getRegisteredAdapters();
  const externalUpdates: NotificationChannels = {};

  for (const adapter of adapterList) {
    const channelKey = adapter.name as keyof typeof settings.channels;
    const isEnabled = settings.channels[channelKey] ?? false;

    if (!isEnabled) {
      externalUpdates[adapter.name] = {
        status: 'skipped',
        error: 'Channel disabled by user settings',
      };
      continue;
    }

    if (!adapter.isConfigured(settings)) {
      externalUpdates[adapter.name] = {
        status: 'skipped',
        error: 'Channel not configured',
      };
      continue;
    }

    // Check match score threshold for job_match notifications
    if (
      payload.kind === 'job_match' &&
      payload.matchScore !== undefined &&
      payload.matchScore < settings.minMatchScore
    ) {
      externalUpdates[adapter.name] = {
        status: 'skipped',
        error: `Match score ${payload.matchScore} below alert threshold ${settings.minMatchScore}`,
      };
      continue;
    }

    // Check quiet hours (unless high-priority approval_needed)
    if (inQuietHours && payload.kind !== 'approval_needed') {
      externalUpdates[adapter.name] = {
        status: 'skipped',
        error: 'Quiet hours active',
      };
      continue;
    }

    try {
      const delivery = await adapter.send(userId, payload, settings);
      externalUpdates[adapter.name] = {
        status: delivery.status,
        sentAt: delivery.status === 'sent' ? delivery.sentAt || new Date().toISOString() : undefined,
        error: delivery.error,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown adapter delivery error';
      externalUpdates[adapter.name] = {
        status: 'failed',
        error: errorMsg,
      };
    }
  }

  // 6. Update notification channels ledger if any external channels were processed
  if (Object.keys(externalUpdates).length > 0) {
    const updated = await updateNotificationChannels(record.id, externalUpdates);
    if (updated) {
      return updated;
    }
  }

  return record;
}

export async function dispatchTestNotification(userId: string): Promise<NotificationRecord> {
  const timestamp = new Date().toISOString();
  return dispatchNotification(userId, {
    kind: 'approval_needed',
    title: 'Test Notification from JobOps Copilot',
    body: `This is a test notification verifying your notification channels at ${timestamp}.`,
    dedupeKey: `test_notification:${userId}:${Date.now()}`,
  });
}

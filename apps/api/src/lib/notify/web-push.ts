import webpush from 'web-push';
import type { NotificationSettings } from '@/types';
import type {
  ChannelDeliveryResult,
  NotificationChannelAdapter,
  NotificationPayload,
} from '@/lib/notify/types';
import {
  deletePushSubscriptionByEndpoint,
  listPushSubscriptions,
} from '@/data/push-subscription-store';

export class WebPushChannelAdapter implements NotificationChannelAdapter {
  name = 'web_push';

  isConfigured(_settings: NotificationSettings): boolean {
    void _settings;
    const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
    const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
    const isMock = process.env.NODE_ENV === 'test' || process.env.MOCK_WEB_PUSH === 'true';

    return Boolean((publicKey && privateKey) || isMock);
  }

  async send(
    userId: string,
    payload: NotificationPayload,
    _settings: NotificationSettings,
  ): Promise<ChannelDeliveryResult> {
    void _settings;
    const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
    const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
    const isMock = process.env.NODE_ENV === 'test' || process.env.MOCK_WEB_PUSH === 'true';

    if (!isMock && (!publicKey || !privateKey)) {
      return {
        status: 'skipped',
        error: 'VAPID keys not configured (VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY required)',
      };
    }

    const subscriptions = await listPushSubscriptions(userId);

    if (subscriptions.length === 0) {
      return {
        status: 'skipped',
        error: 'No active web push subscriptions registered for user',
      };
    }

    if (isMock) {
      return {
        status: 'sent',
        sentAt: new Date().toISOString(),
      };
    }

    const subject = process.env.VAPID_SUBJECT || 'mailto:notifications@jobops.dev';
    webpush.setVapidDetails(subject, publicKey!, privateKey!);

    const pushPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: payload.dedupeKey || `jobops-${payload.kind}-${Date.now()}`,
      data: {
        jobId: payload.jobId,
        kind: payload.kind,
        url: payload.jobId ? `/jobs/${payload.jobId}` : '/feed',
        matchScore: payload.matchScore,
      },
    });

    let sentCount = 0;
    let lastError = '';

    for (const sub of subscriptions) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, pushPayload);
        sentCount += 1;
      } catch (err: unknown) {
        const error = err as { statusCode?: number; message?: string };
        if (error.statusCode === 404 || error.statusCode === 410) {
          // Subscription expired or unregistered by browser, auto-prune
          await deletePushSubscriptionByEndpoint(sub.endpoint).catch(() => {});
        }
        lastError = error.message || 'Push dispatch error';
      }
    }

    if (sentCount > 0) {
      return {
        status: 'sent',
        sentAt: new Date().toISOString(),
      };
    }

    return {
      status: 'failed',
      error: `All ${subscriptions.length} push subscription deliveries failed: ${lastError}`,
    };
  }
}

export const webPushAdapter = new WebPushChannelAdapter();

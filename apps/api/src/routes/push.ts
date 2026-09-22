import { Router } from 'express';
import { requireUser } from '@/lib/auth';
import {
  deletePushSubscription,
  listPushSubscriptions,
  upsertPushSubscription,
} from '@/data/push-subscription-store';

export const pushRouter = Router();

// GET /api/push/vapid-key - returns public key for browser registration
pushRouter.get('/push/vapid-key', (_request, response) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || null;
  return response.json({ publicKey });
});

// GET /api/push/subscriptions - list user's subscriptions
pushRouter.get('/push/subscriptions', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  try {
    const subscriptions = await listPushSubscriptions(userId);
    return response.json({ subscriptions });
  } catch (error) {
    console.error('Failed to list push subscriptions:', error);
    return response.status(500).json({ error: 'Failed to list push subscriptions' });
  }
});

// POST /api/push/subscribe - register or update a web push subscription
pushRouter.post('/push/subscribe', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const { subscription, userAgent } = request.body || {};

  if (!subscription || typeof subscription !== 'object') {
    return response.status(400).json({ error: 'Missing subscription payload' });
  }

  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys?.p256dh;
  const auth = subscription.keys?.auth;

  if (
    typeof endpoint !== 'string' ||
    !endpoint.startsWith('https://') ||
    typeof p256dh !== 'string' ||
    !p256dh.trim() ||
    typeof auth !== 'string' ||
    !auth.trim()
  ) {
    return response.status(400).json({ error: 'Invalid push subscription fields' });
  }

  try {
    const record = await upsertPushSubscription(userId, {
      endpoint,
      keys: { p256dh: p256dh.trim(), auth: auth.trim() },
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    });

    return response.status(201).json({ success: true, subscription: record });
  } catch (error) {
    console.error('Failed to save push subscription:', error);
    return response.status(500).json({ error: 'Failed to save push subscription' });
  }
});

// DELETE /api/push/subscribe - unsubscribe an endpoint
pushRouter.delete('/push/subscribe', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const endpoint = request.body?.endpoint || request.query?.endpoint;

  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    return response.status(400).json({ error: 'Missing endpoint to unsubscribe' });
  }

  try {
    await deletePushSubscription(userId, endpoint.trim());
    return response.json({ success: true });
  } catch (error) {
    console.error('Failed to delete push subscription:', error);
    return response.status(500).json({ error: 'Failed to delete push subscription' });
  }
});

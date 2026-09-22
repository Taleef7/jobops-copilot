import { Router } from 'express';
import {
  countUnreadNotifications,
  getNotificationById,
  getNotificationSettings,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationSettings,
} from '@/data/notification-store';
import { requireUser } from '@/lib/auth';
import { dispatchTestNotification } from '@/lib/notify/dispatcher';
import type { NotificationSettings } from '@/types';

export const notificationsRouter = Router();

// 1. List notifications + unread count
notificationsRouter.get('/notifications', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const unreadOnly = request.query.unreadOnly === 'true' || request.query.unreadOnly === '1';
  const limit = request.query.limit ? parseInt(request.query.limit as string, 10) : 50;
  const offset = request.query.offset ? parseInt(request.query.offset as string, 10) : 0;

  try {
    const [notifications, unreadCount] = await Promise.all([
      listNotifications(userId, { unreadOnly, limit, offset }),
      countUnreadNotifications(userId),
    ]);

    return response.json({
      notifications,
      unreadCount,
    });
  } catch (error) {
    console.error('Error listing notifications:', error);
    return response.status(500).json({ error: 'Failed to list notifications' });
  }
});

// 2. Mark specific notification as read
notificationsRouter.post('/notifications/:id/read', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const id = request.params.id;
  try {
    const existing = await getNotificationById(userId, id);
    if (!existing) {
      return response.status(404).json({ error: 'Notification not found' });
    }

    const updated = await markNotificationRead(userId, id);
    return response.json({ notification: updated });
  } catch (error) {
    console.error('Error marking notification read:', error);
    return response.status(500).json({ error: 'Failed to mark notification read' });
  }
});

// 3. Mark all notifications as read
notificationsRouter.post('/notifications/read-all', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  try {
    const markedCount = await markAllNotificationsRead(userId);
    return response.json({ markedCount });
  } catch (error) {
    console.error('Error marking all notifications read:', error);
    return response.status(500).json({ error: 'Failed to mark all notifications read' });
  }
});

// 4. Get notification settings
notificationsRouter.get('/notification-settings', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  try {
    const settings = await getNotificationSettings(userId);
    return response.json({ settings });
  } catch (error) {
    console.error('Error getting notification settings:', error);
    return response.status(500).json({ error: 'Failed to get notification settings' });
  }
});

// 5. Update notification settings
notificationsRouter.put('/notification-settings', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  const body = request.body || {};
  const patch: Partial<NotificationSettings> = {};

  if (body.channels && typeof body.channels === 'object') {
    patch.channels = {
      in_app: typeof body.channels.in_app === 'boolean' ? body.channels.in_app : true,
      email: typeof body.channels.email === 'boolean' ? body.channels.email : false,
      telegram: typeof body.channels.telegram === 'boolean' ? body.channels.telegram : false,
      web_push: typeof body.channels.web_push === 'boolean' ? body.channels.web_push : false,
    };
  }

  if (typeof body.minMatchScore === 'number') {
    if (body.minMatchScore < 0 || body.minMatchScore > 100) {
      return response.status(400).json({ error: 'minMatchScore must be between 0 and 100' });
    }
    patch.minMatchScore = body.minMatchScore;
  }

  if (typeof body.digestHour === 'number') {
    if (body.digestHour < 0 || body.digestHour > 23) {
      return response.status(400).json({ error: 'digestHour must be between 0 and 23' });
    }
    patch.digestHour = body.digestHour;
  }

  if (body.quietHours && typeof body.quietHours === 'object') {
    const qh = body.quietHours;
    patch.quietHours = {
      enabled: Boolean(qh.enabled),
      start: typeof qh.start === 'string' && /^\d{1,2}:\d{2}$/.test(qh.start) ? qh.start : '22:00',
      end: typeof qh.end === 'string' && /^\d{1,2}:\d{2}$/.test(qh.end) ? qh.end : '08:00',
      timezone: typeof qh.timezone === 'string' ? qh.timezone : undefined,
    };
  }

  if (body.telegramChatId !== undefined) {
    patch.telegramChatId = typeof body.telegramChatId === 'string' ? body.telegramChatId.trim() : null;
  }

  if (body.emailAddress !== undefined) {
    patch.emailAddress = typeof body.emailAddress === 'string' ? body.emailAddress.trim() : null;
  }

  try {
    const updated = await updateNotificationSettings(userId, patch);
    return response.json({ settings: updated });
  } catch (error) {
    console.error('Error updating notification settings:', error);
    return response.status(500).json({ error: 'Failed to update notification settings' });
  }
});

// 6. Test notifications across configured channels
notificationsRouter.post('/notifications/test', async (request, response) => {
  const userId = requireUser(request, response);
  if (!userId) return;

  try {
    const notification = await dispatchTestNotification(userId);
    return response.json({ notification });
  } catch (error) {
    console.error('Error sending test notification:', error);
    return response.status(500).json({ error: 'Failed to send test notification' });
  }
});

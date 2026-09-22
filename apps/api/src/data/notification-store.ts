import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CreateNotificationInput,
  NotificationChannels,
  NotificationRecord,
  NotificationSettings,
} from '@/types';
import { hasPostgresConnection } from '@/lib/postgres';
import * as postgresStore from '@/data/notification-store.postgres';

export { DEFAULT_NOTIFICATION_SETTINGS } from '@/data/notification-store.postgres';

let cache: NotificationRecord[] | null = null;
let settingsCache: Record<string, NotificationSettings> | null = null;
let loadPromise: Promise<void> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function dataDir() {
  return join(process.cwd(), 'data');
}

function notifFile() {
  return join(dataDir(), 'notifications.json');
}

function settingsFile() {
  return join(dataDir(), 'notification-settings.json');
}

async function load(): Promise<void> {
  await mkdir(dataDir(), { recursive: true });

  try {
    const raw = await readFile(notifFile(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    cache = Array.isArray(parsed) ? (parsed as NotificationRecord[]) : [];
  } catch {
    cache = [];
  }

  try {
    const raw = await readFile(settingsFile(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    settingsCache = parsed && typeof parsed === 'object' ? (parsed as Record<string, NotificationSettings>) : {};
  } catch {
    settingsCache = {};
  }
}

async function ensureLoaded(): Promise<void> {
  if (cache !== null && settingsCache !== null) {
    return;
  }
  loadPromise ??= load();
  await loadPromise;
}

async function persist() {
  if (!cache || !settingsCache) {
    return;
  }
  await mkdir(dataDir(), { recursive: true });
  await writeFile(notifFile(), `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  await writeFile(settingsFile(), `${JSON.stringify(settingsCache, null, 2)}\n`, 'utf8');
}

function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function insertNotification(
  userId: string,
  input: CreateNotificationInput,
): Promise<NotificationRecord> {
  if (hasPostgresConnection()) {
    return postgresStore.insertNotification(userId, input);
  }

  return mutate(async () => {
    await ensureLoaded();

    if (input.dedupeKey) {
      const existing = cache!.find((n) => n.dedupeKey === input.dedupeKey);
      if (existing) {
        return clone(existing);
      }
    }

    const created: NotificationRecord = {
      id: randomUUID(),
      userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      jobId: input.jobId ?? undefined,
      dedupeKey: input.dedupeKey ?? undefined,
      channels: input.channels ?? { in_app: { status: 'sent', sentAt: new Date().toISOString() } },
      createdAt: new Date().toISOString(),
    };

    cache!.push(created);
    await persist();
    return clone(created);
  });
}

export async function getNotificationById(
  userId: string,
  id: string,
): Promise<NotificationRecord | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.getNotificationById(userId, id);
  }

  await ensureLoaded();
  const found = cache!.find((n) => n.userId === userId && n.id === id);
  return found ? clone(found) : undefined;
}

export async function getNotificationByDedupeKey(
  dedupeKey: string,
): Promise<NotificationRecord | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.getNotificationByDedupeKey(dedupeKey);
  }

  await ensureLoaded();
  const found = cache!.find((n) => n.dedupeKey === dedupeKey);
  return found ? clone(found) : undefined;
}

export async function listNotifications(
  userId: string,
  options?: { unreadOnly?: boolean; limit?: number; offset?: number },
): Promise<NotificationRecord[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listNotifications(userId, options);
  }

  await ensureLoaded();
  let userNotifs = cache!.filter((n) => n.userId === userId);

  if (options?.unreadOnly) {
    userNotifs = userNotifs.filter((n) => !n.readAt);
  }

  userNotifs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const limit = Math.max(1, Math.min(options?.limit ?? 50, 100));
  const offset = Math.max(0, options?.offset ?? 0);

  return userNotifs.slice(offset, offset + limit).map(clone);
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  if (hasPostgresConnection()) {
    return postgresStore.countUnreadNotifications(userId);
  }

  await ensureLoaded();
  return cache!.filter((n) => n.userId === userId && !n.readAt).length;
}

export async function markNotificationRead(
  userId: string,
  id: string,
): Promise<NotificationRecord | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.markNotificationRead(userId, id);
  }

  return mutate(async () => {
    await ensureLoaded();
    const item = cache!.find((n) => n.userId === userId && n.id === id);
    if (!item) return undefined;

    if (!item.readAt) {
      item.readAt = new Date().toISOString();
      await persist();
    }
    return clone(item);
  });
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  if (hasPostgresConnection()) {
    return postgresStore.markAllNotificationsRead(userId);
  }

  return mutate(async () => {
    await ensureLoaded();
    let count = 0;
    const now = new Date().toISOString();

    for (const item of cache!) {
      if (item.userId === userId && !item.readAt) {
        item.readAt = now;
        count++;
      }
    }

    if (count > 0) {
      await persist();
    }
    return count;
  });
}

export async function updateNotificationChannels(
  id: string,
  channels: NotificationChannels,
): Promise<NotificationRecord | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.updateNotificationChannels(id, channels);
  }

  return mutate(async () => {
    await ensureLoaded();
    const item = cache!.find((n) => n.id === id);
    if (!item) return undefined;

    item.channels = {
      ...item.channels,
      ...channels,
    };
    await persist();
    return clone(item);
  });
}

export async function getNotificationSettings(userId: string): Promise<NotificationSettings> {
  if (hasPostgresConnection()) {
    return postgresStore.getNotificationSettings(userId);
  }

  await ensureLoaded();
  const current = settingsCache![userId];
  if (!current) {
    return clone(postgresStore.DEFAULT_NOTIFICATION_SETTINGS);
  }

  return clone({
    ...postgresStore.DEFAULT_NOTIFICATION_SETTINGS,
    ...current,
    channels: {
      ...postgresStore.DEFAULT_NOTIFICATION_SETTINGS.channels,
      ...(current.channels ?? {}),
    },
    quietHours: {
      ...postgresStore.DEFAULT_NOTIFICATION_SETTINGS.quietHours,
      ...(current.quietHours ?? {}),
    },
  });
}

export async function updateNotificationSettings(
  userId: string,
  settingsPatch: Partial<NotificationSettings>,
): Promise<NotificationSettings> {
  if (hasPostgresConnection()) {
    return postgresStore.updateNotificationSettings(userId, settingsPatch);
  }

  return mutate(async () => {
    await ensureLoaded();
    const current = await getNotificationSettings(userId);
    const updated: NotificationSettings = {
      ...current,
      ...settingsPatch,
      channels: {
        ...current.channels,
        ...(settingsPatch.channels ?? {}),
      },
      quietHours: {
        ...current.quietHours,
        ...(settingsPatch.quietHours ?? {}),
      },
    };

    settingsCache![userId] = updated;
    await persist();
    return clone(updated);
  });
}

export async function listUsersForDigest(
  targetHour?: number,
): Promise<Array<{ userId: string; settings: NotificationSettings }>> {
  if (hasPostgresConnection()) {
    return postgresStore.listUsersForDigest(targetHour);
  }

  await ensureLoaded();
  const results: Array<{ userId: string; settings: NotificationSettings }> = [];

  for (const [userId, current] of Object.entries(settingsCache ?? {})) {
    const settings: NotificationSettings = {
      ...postgresStore.DEFAULT_NOTIFICATION_SETTINGS,
      ...current,
      channels: {
        ...postgresStore.DEFAULT_NOTIFICATION_SETTINGS.channels,
        ...(current.channels ?? {}),
      },
      quietHours: {
        ...postgresStore.DEFAULT_NOTIFICATION_SETTINGS.quietHours,
        ...(current.quietHours ?? {}),
      },
    };

    if (targetHour !== undefined && settings.digestHour !== targetHour) {
      continue;
    }

    results.push({ userId, settings });
  }

  return results;
}

export async function _resetNotificationStoreForTests(
  initialNotifs: NotificationRecord[] = [],
  initialSettings: Record<string, NotificationSettings> = {},
) {
  cache = clone(initialNotifs);
  settingsCache = clone(initialSettings);
  loadPromise = null;
  await persist();
}

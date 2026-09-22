import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hasPostgresConnection } from '@/lib/postgres';
import * as postgresStore from './push-subscription-store.postgres';
import type {
  PushSubscriptionRecord,
  UpsertPushSubscriptionInput,
} from './push-subscription-store.postgres';

export type { PushSubscriptionRecord, UpsertPushSubscriptionInput };

function dataDir() {
  return join(process.cwd(), 'data');
}

function dataFile() {
  return join(dataDir(), 'push-subscriptions.json');
}

let cache: PushSubscriptionRecord[] | null = null;
let loadPromise: Promise<PushSubscriptionRecord[]> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

function clone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val)) as T;
}

async function load(): Promise<PushSubscriptionRecord[]> {
  await mkdir(dataDir(), { recursive: true });
  try {
    const raw = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      cache = parsed as PushSubscriptionRecord[];
    } else {
      cache = [];
    }
  } catch {
    cache = [];
  }
  return cache;
}

async function ensureLoaded(): Promise<PushSubscriptionRecord[]> {
  if (cache) return cache;
  loadPromise ??= load();
  return loadPromise;
}

async function persist(): Promise<void> {
  if (!cache) return;
  await mkdir(dataDir(), { recursive: true });
  await writeFile(dataFile(), `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

async function mutate<T>(op: () => Promise<T>): Promise<T> {
  const prev = mutationQueue;
  let release!: () => void;
  mutationQueue = new Promise((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await op();
  } finally {
    release();
  }
}

export async function upsertPushSubscription(
  userId: string,
  input: UpsertPushSubscriptionInput,
): Promise<PushSubscriptionRecord> {
  if (hasPostgresConnection()) {
    return postgresStore.upsertPushSubscription(userId, input);
  }

  return mutate(async () => {
    const records = await ensureLoaded();
    const existingIndex = records.findIndex((r) => r.endpoint === input.endpoint);
    const now = new Date().toISOString();

    if (existingIndex >= 0) {
      const existing = records[existingIndex]!;
      const updated: PushSubscriptionRecord = {
        ...existing,
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? existing.userAgent,
        updatedAt: now,
      };
      records[existingIndex] = updated;
      await persist();
      return clone(updated);
    }

    const created: PushSubscriptionRecord = {
      id: randomUUID(),
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent,
      createdAt: now,
      updatedAt: now,
    };
    records.push(created);
    await persist();
    return clone(created);
  });
}

export async function deletePushSubscription(userId: string, endpoint: string): Promise<boolean> {
  if (hasPostgresConnection()) {
    return postgresStore.deletePushSubscription(userId, endpoint);
  }

  return mutate(async () => {
    const records = await ensureLoaded();
    const initialLen = records.length;
    cache = records.filter((r) => !(r.userId === userId && r.endpoint === endpoint));
    const changed = cache.length < initialLen;
    if (changed) {
      await persist();
    }
    return changed;
  });
}

export async function deletePushSubscriptionByEndpoint(endpoint: string): Promise<boolean> {
  if (hasPostgresConnection()) {
    return postgresStore.deletePushSubscriptionByEndpoint(endpoint);
  }

  return mutate(async () => {
    const records = await ensureLoaded();
    const initialLen = records.length;
    cache = records.filter((r) => r.endpoint !== endpoint);
    const changed = cache.length < initialLen;
    if (changed) {
      await persist();
    }
    return changed;
  });
}

export async function listPushSubscriptions(userId: string): Promise<PushSubscriptionRecord[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listPushSubscriptions(userId);
  }

  const records = await ensureLoaded();
  return clone(records.filter((r) => r.userId === userId));
}

export async function _resetPushSubscriptionStoreForTests(initial: PushSubscriptionRecord[] = []) {
  cache = clone(initial);
  loadPromise = null;
  await persist();
}

import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreateExtTokenResult, ExtTokenRecord } from '@/types';
import { hasPostgresConnection } from '@/lib/postgres';
import * as postgresStore from '@/data/ext-token-store.postgres';

export { hashToken } from '@/data/ext-token-store.postgres';

let cache: ExtTokenRecord[] | null = null;
let loadPromise: Promise<ExtTokenRecord[]> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function dataDir() {
  return join(process.cwd(), 'data');
}

function dataFile() {
  return join(dataDir(), 'ext-tokens.json');
}

async function load(): Promise<ExtTokenRecord[]> {
  await mkdir(dataDir(), { recursive: true });
  try {
    const raw = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid ext-tokens store contents');
    }
    cache = parsed as ExtTokenRecord[];
  } catch {
    cache = [];
    await persist();
  }
  return cache;
}

async function ensureLoaded(): Promise<ExtTokenRecord[]> {
  if (cache) {
    return cache;
  }
  loadPromise ??= load();
  return loadPromise;
}

async function persist() {
  if (!cache) {
    return;
  }
  await mkdir(dataDir(), { recursive: true });
  await writeFile(dataFile(), `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const previous = mutationQueue;
  let release!: () => void;
  mutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export async function createExtToken(userId: string, label = 'Chrome Extension'): Promise<CreateExtTokenResult> {
  if (hasPostgresConnection()) {
    return postgresStore.createExtToken(userId, label);
  }
  return runExclusive(async () => {
    const all = await ensureLoaded();
    const rawToken = `jop_${randomBytes(24).toString('hex')}`;
    const tokenHash = postgresStore.hashToken(rawToken);

    const record: ExtTokenRecord = {
      id: randomUUID(),
      userId,
      tokenHash,
      label: label.trim() || 'Chrome Extension',
      createdAt: new Date().toISOString(),
    };
    all.unshift(record);
    await persist();
    return { token: rawToken, record: clone(record) };
  });
}

export async function listExtTokens(userId: string): Promise<ExtTokenRecord[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listExtTokens(userId);
  }
  const all = await ensureLoaded();
  return clone(
    all
      .filter((t) => t.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  );
}

export async function findExtTokenByHash(tokenHash: string): Promise<ExtTokenRecord | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.findExtTokenByHash(tokenHash);
  }
  const all = await ensureLoaded();
  const match = all.find((t) => t.tokenHash === tokenHash && !t.revokedAt);
  return match ? clone(match) : undefined;
}

export async function touchExtToken(tokenHash: string): Promise<void> {
  if (hasPostgresConnection()) {
    return postgresStore.touchExtToken(tokenHash);
  }
  return runExclusive(async () => {
    const all = await ensureLoaded();
    const match = all.find((t) => t.tokenHash === tokenHash);
    if (match) {
      match.lastUsedAt = new Date().toISOString();
      await persist();
    }
  });
}

export async function revokeExtToken(userId: string, tokenId: string): Promise<boolean> {
  if (hasPostgresConnection()) {
    return postgresStore.revokeExtToken(userId, tokenId);
  }
  return runExclusive(async () => {
    const all = await ensureLoaded();
    const match = all.find((t) => t.userId === userId && t.id === tokenId && !t.revokedAt);
    if (!match) return false;
    match.revokedAt = new Date().toISOString();
    await persist();
    return true;
  });
}

export async function verifyAndTouchExtToken(rawToken: string): Promise<ExtTokenRecord | null> {
  if (hasPostgresConnection()) {
    return postgresStore.verifyAndTouchExtToken(rawToken);
  }
  const hash = postgresStore.hashToken(rawToken);
  const record = await findExtTokenByHash(hash);
  if (!record || record.revokedAt) {
    return null;
  }
  await touchExtToken(hash);
  record.lastUsedAt = new Date().toISOString();
  return record;
}

export async function _resetExtTokenStoreForTests(initial: ExtTokenRecord[] = []) {
  cache = clone(initial);
  loadPromise = null;
  await persist();
}

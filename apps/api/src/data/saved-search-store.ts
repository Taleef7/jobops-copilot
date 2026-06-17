import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreateSavedSearchBody, SavedSearch } from '@/types';
import { hasPostgresConnection } from '@/lib/postgres';
import * as postgresStore from '@/data/saved-search-store.postgres';

let cache: SavedSearch[] | null = null;
let loadPromise: Promise<SavedSearch[]> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function dataDir() {
  return join(process.cwd(), 'data');
}

function dataFile() {
  return join(dataDir(), 'saved-searches.json');
}

async function load(): Promise<SavedSearch[]> {
  await mkdir(dataDir(), { recursive: true });
  try {
    const raw = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid saved-search store contents');
    }
    cache = parsed as SavedSearch[];
  } catch {
    cache = [];
    await persist();
  }
  return cache;
}

async function ensureLoaded(): Promise<SavedSearch[]> {
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

export async function listSavedSearches(userId: string): Promise<SavedSearch[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listSavedSearches(userId);
  }
  const all = await ensureLoaded();
  return clone(
    all
      .filter((entry) => entry.userId === userId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
  );
}

export async function createSavedSearch(userId: string, body: CreateSavedSearchBody): Promise<SavedSearch> {
  if (hasPostgresConnection()) {
    return postgresStore.createSavedSearch(userId, body);
  }
  return runExclusive(async () => {
    const all = await ensureLoaded();
    const now = new Date().toISOString();
    const search: SavedSearch = {
      id: randomUUID(),
      userId,
      query: body.query.trim(),
      location: body.location?.trim() || undefined,
      remoteOnly: Boolean(body.remoteOnly),
      createdAt: now,
      updatedAt: now,
    };
    all.unshift(search);
    await persist();
    return clone(search);
  });
}

export async function deleteSavedSearch(userId: string, id: string): Promise<boolean> {
  if (hasPostgresConnection()) {
    return postgresStore.deleteSavedSearch(userId, id);
  }
  return runExclusive(async () => {
    const all = await ensureLoaded();
    const before = all.length;
    cache = all.filter((entry) => !(entry.id === id && entry.userId === userId));
    await persist();
    return cache.length < before;
  });
}

export async function listUsersWithSavedSearches(): Promise<string[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listUsersWithSavedSearches();
  }
  const all = await ensureLoaded();
  return [...new Set(all.map((entry) => entry.userId).filter((id): id is string => Boolean(id)))];
}

export async function clearUserSavedSearches(userId: string): Promise<void> {
  if (hasPostgresConnection()) {
    return postgresStore.clearUserSavedSearches(userId);
  }
  return runExclusive(async () => {
    const all = await ensureLoaded();
    cache = all.filter((entry) => entry.userId !== userId);
    await persist();
  });
}

export function resetSavedSearchStoreForTests() {
  cache = null;
  loadPromise = null;
  mutationQueue = Promise.resolve();
}

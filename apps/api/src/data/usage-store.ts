import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hasPostgresConnection } from '@/lib/postgres';
import * as postgresStore from '@/data/usage-store.postgres';

export interface DailyUsage {
  costUsd: number;
  calls: number;
}

interface UsageRecord {
  userId: string;
  date: string; // UTC day, YYYY-MM-DD
  costUsd: number;
  calls: number;
}

let cache: UsageRecord[] | null = null;
let loadPromise: Promise<UsageRecord[]> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dataDir() {
  return join(process.cwd(), 'data');
}

function dataFile() {
  return join(dataDir(), 'ai-usage.json');
}

async function load(): Promise<UsageRecord[]> {
  await mkdir(dataDir(), { recursive: true });
  try {
    const raw = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid ai-usage store contents');
    }
    cache = parsed as UsageRecord[];
  } catch {
    cache = [];
    await persist();
  }
  return cache;
}

async function ensureLoaded(): Promise<UsageRecord[]> {
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

/** Add a paid AI call's cost to the user's spend for today (UTC). */
export async function addUsage(userId: string, costUsd: number): Promise<void> {
  if (hasPostgresConnection()) {
    return postgresStore.addUsage(userId, costUsd);
  }
  return runExclusive(async () => {
    const all = await ensureLoaded();
    const date = today();
    const existing = all.find((entry) => entry.userId === userId && entry.date === date);
    if (existing) {
      existing.costUsd += costUsd;
      existing.calls += 1;
    } else {
      all.push({ userId, date, costUsd, calls: 1 });
    }
    await persist();
  });
}

/** Today's accumulated spend + call count for the user (zero when none). */
export async function getTodayUsage(userId: string): Promise<DailyUsage> {
  if (hasPostgresConnection()) {
    return postgresStore.getTodayUsage(userId);
  }
  const all = await ensureLoaded();
  const date = today();
  const record = all.find((entry) => entry.userId === userId && entry.date === date);
  return record ? { costUsd: record.costUsd, calls: record.calls } : { costUsd: 0, calls: 0 };
}

export function resetUsageStoreForTests() {
  cache = null;
  loadPromise = null;
  mutationQueue = Promise.resolve();
}

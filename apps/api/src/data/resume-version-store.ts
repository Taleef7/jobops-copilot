import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PoolClient } from 'pg';
import * as postgresStore from '@/data/resume-version-store.postgres';
import { hasPostgresConnection } from '@/lib/postgres';
import type { ResumeVersionRecord } from '@/types';

export type { ResumeVersionRecord } from '@/types';

let cache: ResumeVersionRecord[] | null = null;
let loadPromise: Promise<ResumeVersionRecord[]> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function dataDir() {
  return join(process.cwd(), 'data');
}

function dataFile() {
  return join(dataDir(), 'resume-versions.json');
}

async function load(): Promise<ResumeVersionRecord[]> {
  await mkdir(dataDir(), { recursive: true });
  try {
    const raw = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid resume-version store contents');
    }
    cache = parsed as ResumeVersionRecord[];
  } catch {
    cache = [];
    await persist();
  }
  return cache;
}

async function ensureLoaded(): Promise<ResumeVersionRecord[]> {
  if (cache) return cache;
  loadPromise ??= load();
  return loadPromise;
}

async function persist() {
  if (!cache) return;
  await mkdir(dataDir(), { recursive: true });
  await writeFile(dataFile(), `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const previous = mutationQueue;
  let release: () => void = () => {};
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

// `client`, here and below: a Postgres transaction to write in (#408). File mode ignores it.
export async function insertResumeVersion(record: ResumeVersionRecord, client?: PoolClient): Promise<ResumeVersionRecord> {
  // Every query filters on the owner, so a version without one could never be shown (#351).
  if (!record.userId?.trim()) {
    throw new Error('A résumé version needs an owner (userId).');
  }
  if (hasPostgresConnection()) {
    return postgresStore.insertResumeVersion(record, client);
  }

  return runExclusive(async () => {
    const items = await ensureLoaded();
    const created: ResumeVersionRecord = {
      ...clone(record),
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.updatedAt || new Date().toISOString(),
    };
    items.unshift(created);
    await persist();
    return clone(created);
  });
}

export async function getResumeVersion(userId: string, id: string): Promise<ResumeVersionRecord | null> {
  if (hasPostgresConnection()) {
    return postgresStore.getResumeVersion(userId, id);
  }

  const items = await ensureLoaded();
  const match = items.find((item) => item.userId === userId && item.id === id);
  return match ? clone(match) : null;
}

export async function listResumeVersionsForJob(userId: string, jobId: string): Promise<ResumeVersionRecord[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listResumeVersionsForJob(userId, jobId);
  }

  const items = await ensureLoaded();
  return items
    .filter((item) => item.userId === userId && item.jobId === jobId)
    .map(clone);
}

export async function listResumeVersionsForUser(userId: string): Promise<ResumeVersionRecord[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listResumeVersionsForUser(userId);
  }

  const items = await ensureLoaded();
  return items.filter((item) => item.userId === userId).map(clone);
}

export async function getBaseResumeVersion(userId: string, client?: PoolClient): Promise<ResumeVersionRecord | null> {
  if (hasPostgresConnection()) {
    return postgresStore.getBaseResumeVersion(userId, client);
  }

  const items = await ensureLoaded();
  const match = items.find((item) => item.userId === userId && item.isBase);
  return match ? clone(match) : null;
}

export interface UpdateOptions {
  /**
   * Change the version only while it is as it was read: its updatedAt, and approved or not. A
   * version that changed meanwhile (another tab, a download) isn't overwritten: null.
   */
  expect?: { updatedAt?: string; approved?: boolean };
}

export async function updateResumeVersion(
  userId: string,
  id: string,
  patch: Partial<ResumeVersionRecord>,
  options: UpdateOptions = {},
  client?: PoolClient,
): Promise<ResumeVersionRecord | null> {
  if (hasPostgresConnection()) {
    return postgresStore.updateResumeVersion(userId, id, patch, options, client);
  }

  return runExclusive(async () => {
    const items = await ensureLoaded();
    const index = items.findIndex((item) => item.userId === userId && item.id === id);
    if (index === -1) return null;

    const existing = items[index]!;
    const { expect } = options;
    if (expect?.updatedAt !== undefined && existing.updatedAt !== expect.updatedAt) return null;
    if (expect?.approved !== undefined && existing.approved !== expect.approved) return null;
    // Always later than before, so two writes in one millisecond still tell apart.
    const previous = Date.parse(existing.updatedAt);
    const updated: ResumeVersionRecord = {
      ...existing,
      ...clone(patch),
      updatedAt: new Date(Number.isNaN(previous) ? Date.now() : Math.max(Date.now(), previous + 1)).toISOString(),
    };
    items[index] = updated;
    await persist();
    return clone(updated);
  });
}

export async function deleteResumeVersions(userId: string): Promise<void> {
  if (hasPostgresConnection()) {
    return postgresStore.deleteResumeVersions(userId);
  }

  await runExclusive(async () => {
    const items = await ensureLoaded();
    cache = items.filter((item) => item.userId !== userId);
    await persist();
  });
}

export async function resetResumeVersionStore(): Promise<void> {
  await runExclusive(async () => {
    cache = [];
    await persist();
  });
}

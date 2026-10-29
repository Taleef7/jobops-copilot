import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as postgresStore from '@/data/cover-letter-store.postgres';
import { hasPostgresConnection } from '@/lib/postgres';
import type { CoverLetterRecord } from '@/types';

/**
 * Cover letters (#416): one per job and user, in their own table (migration 031), so an outreach
 * draft, which replaces the job's unsent drafts, never touches one. Without Postgres (tests,
 * local runs), a JSON file like the résumé versions' store.
 */

export interface CoverLetterUpdateOptions {
  /** Change the letter only while it is as it was read (another tab may have changed it): null. */
  expect?: { updatedAt?: string };
}

let cache: CoverLetterRecord[] | null = null;
let loadPromise: Promise<CoverLetterRecord[]> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const dataDir = () => join(process.cwd(), 'data');
const dataFile = () => join(dataDir(), 'cover-letters.json');

async function load(): Promise<CoverLetterRecord[]> {
  await mkdir(dataDir(), { recursive: true });
  try {
    const parsed = JSON.parse(await readFile(dataFile(), 'utf8')) as unknown;
    if (!Array.isArray(parsed)) throw new Error('Invalid cover letter store contents');
    cache = parsed as CoverLetterRecord[];
  } catch {
    cache = [];
    await persist();
  }
  return cache;
}

async function ensureLoaded(): Promise<CoverLetterRecord[]> {
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

export async function getCoverLetter(userId: string, jobId: string): Promise<CoverLetterRecord | null> {
  if (hasPostgresConnection()) return postgresStore.getCoverLetter(userId, jobId);
  const items = await ensureLoaded();
  const match = items.find((item) => item.userId === userId && item.jobId === jobId);
  return match ? clone(match) : null;
}

/** Saves the job's letter, replacing the one it had: one letter per job and user. */
export async function saveCoverLetter(record: CoverLetterRecord): Promise<CoverLetterRecord> {
  if (!record.userId?.trim()) throw new Error('A cover letter needs an owner (userId).');
  if (record.length !== 'concise' && record.length !== 'full') throw new Error(`Not a cover letter length: ${String(record.length)}`);
  if (hasPostgresConnection()) return postgresStore.saveCoverLetter(record);
  return runExclusive(async () => {
    const items = await ensureLoaded();
    cache = [clone(record), ...items.filter((item) => !(item.userId === record.userId && item.jobId === record.jobId))];
    await persist();
    return clone(record);
  });
}

export async function updateCoverLetter(
  userId: string,
  jobId: string,
  patch: Pick<Partial<CoverLetterRecord>, 'paragraphs' | 'checks'>,
  options: CoverLetterUpdateOptions = {},
): Promise<CoverLetterRecord | null> {
  if (hasPostgresConnection()) return postgresStore.updateCoverLetter(userId, jobId, patch, options);
  return runExclusive(async () => {
    const items = await ensureLoaded();
    const index = items.findIndex((item) => item.userId === userId && item.jobId === jobId);
    if (index === -1) return null;
    const existing = items[index]!;
    if (options.expect?.updatedAt !== undefined && existing.updatedAt !== options.expect.updatedAt) return null;
    // Always later than before, so two writes in one millisecond still tell apart.
    const previous = Date.parse(existing.updatedAt);
    const updated: CoverLetterRecord = {
      ...existing,
      ...clone(patch),
      updatedAt: new Date(Number.isNaN(previous) ? Date.now() : Math.max(Date.now(), previous + 1)).toISOString(),
    };
    items[index] = updated;
    await persist();
    return clone(updated);
  });
}

export async function deleteCoverLetters(userId: string): Promise<void> {
  if (hasPostgresConnection()) return postgresStore.deleteCoverLetters(userId);
  await runExclusive(async () => {
    const items = await ensureLoaded();
    cache = items.filter((item) => item.userId !== userId);
    await persist();
  });
}

export async function resetCoverLetterStoreForTests(): Promise<void> {
  await runExclusive(async () => {
    cache = [];
    loadPromise = null;
    await persist();
  });
}

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreateTargetCompanyBody, TargetCompany } from '@/types';
import { hasPostgresConnection } from '@/lib/postgres';
import * as postgresStore from '@/data/target-company-store.postgres';

let cache: TargetCompany[] | null = null;
let loadPromise: Promise<TargetCompany[]> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function dataDir() {
  return join(process.cwd(), 'data');
}

function dataFile() {
  return join(dataDir(), 'target-companies.json');
}

async function load(): Promise<TargetCompany[]> {
  await mkdir(dataDir(), { recursive: true });
  try {
    const raw = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid target-company store contents');
    }
    cache = parsed as TargetCompany[];
  } catch {
    cache = [];
    await persist();
  }
  return cache;
}

async function ensureLoaded(): Promise<TargetCompany[]> {
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

export async function listTargetCompanies(userId: string): Promise<TargetCompany[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listTargetCompanies(userId);
  }
  const all = await ensureLoaded();
  return clone(
    all
      .filter((entry) => entry.userId === userId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
  );
}

export async function listEnabledTargetCompanies(userId: string): Promise<TargetCompany[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listEnabledTargetCompanies(userId);
  }
  const all = await ensureLoaded();
  return clone(
    all
      .filter((entry) => entry.userId === userId && entry.enabled)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
  );
}

export async function createTargetCompany(userId: string, body: CreateTargetCompanyBody): Promise<TargetCompany> {
  if (hasPostgresConnection()) {
    return postgresStore.createTargetCompany(userId, body);
  }
  return runExclusive(async () => {
    const all = await ensureLoaded();
    const duplicate = all.find(
      (e) => e.userId === userId && e.boardType === body.boardType && e.boardToken === body.boardToken,
    );
    if (duplicate) {
      throw new Error('This board is already tracked.');
    }
    const now = new Date().toISOString();
    const entry: TargetCompany = {
      id: randomUUID(),
      userId,
      company: body.company,
      boardType: body.boardType,
      boardToken: body.boardToken,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    all.unshift(entry);
    await persist();
    return clone(entry);
  });
}

export async function setTargetCompanyEnabled(
  userId: string,
  id: string,
  enabled: boolean,
): Promise<TargetCompany | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.setTargetCompanyEnabled(userId, id, enabled);
  }
  return runExclusive(async () => {
    const all = await ensureLoaded();
    const entry = all.find((e) => e.id === id && e.userId === userId);
    if (!entry) return undefined;
    entry.enabled = enabled;
    entry.updatedAt = new Date().toISOString();
    await persist();
    return clone(entry);
  });
}

export async function deleteTargetCompany(userId: string, id: string): Promise<boolean> {
  if (hasPostgresConnection()) {
    return postgresStore.deleteTargetCompany(userId, id);
  }
  return runExclusive(async () => {
    const all = await ensureLoaded();
    const before = all.length;
    cache = all.filter((entry) => !(entry.id === id && entry.userId === userId));
    await persist();
    return cache.length < before;
  });
}

export function resetTargetCompanyStoreForTests() {
  cache = null;
  loadPromise = null;
  mutationQueue = Promise.resolve();
}

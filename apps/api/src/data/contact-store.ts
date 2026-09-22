import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CreateJobContactBody,
  JobContactRecord,
  UpdateJobContactBody,
} from '@/types';
import { hasPostgresConnection } from '@/lib/postgres';
import * as postgresStore from '@/data/contact-store.postgres';

export { normalizeEvidence } from '@/data/contact-store.postgres';

let cache: JobContactRecord[] | null = null;
let loadPromise: Promise<JobContactRecord[]> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function dataDir() {
  return join(process.cwd(), 'data');
}

function dataFile() {
  return join(dataDir(), 'job-contacts.json');
}

async function load(): Promise<JobContactRecord[]> {
  await mkdir(dataDir(), { recursive: true });
  try {
    const raw = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid job-contacts store contents');
    }
    cache = parsed as JobContactRecord[];
  } catch {
    cache = [];
    await persist();
  }
  return cache;
}

async function ensureLoaded(): Promise<JobContactRecord[]> {
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

export async function listJobContacts(userId: string, jobId: string): Promise<JobContactRecord[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listJobContacts(userId, jobId);
  }
  const all = await ensureLoaded();
  return clone(
    all
      .filter((c) => c.userId === userId && c.jobId === jobId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
  );
}

export async function getJobContactById(userId: string, id: string): Promise<JobContactRecord | null> {
  if (hasPostgresConnection()) {
    return postgresStore.getJobContactById(userId, id);
  }
  const all = await ensureLoaded();
  const match = all.find((c) => c.userId === userId && c.id === id);
  return match ? clone(match) : null;
}

export async function insertJobContact(
  userId: string,
  jobId: string,
  body: CreateJobContactBody,
): Promise<JobContactRecord> {
  if (hasPostgresConnection()) {
    return postgresStore.insertJobContact(userId, jobId, body);
  }

  const evidence = postgresStore.normalizeEvidence(body.evidence);
  if (evidence.length === 0) {
    throw new Error('Every contact must carry at least 1 public evidence URL');
  }

  return runExclusive(async () => {
    const all = await ensureLoaded();
    const now = new Date().toISOString();
    const created: JobContactRecord = {
      id: randomUUID(),
      userId,
      jobId,
      name: body.name.trim(),
      roleTitle: body.roleTitle.trim(),
      evidence,
      relevance: body.relevance?.trim() || null,
      email: body.email?.trim() || null,
      linkedinUrl: body.linkedinUrl?.trim() || null,
      status: body.status || 'found',
      notes: body.notes?.trim() || null,
      createdAt: now,
      updatedAt: now,
    };

    all.push(created);
    await persist();
    return clone(created);
  });
}

export async function updateJobContact(
  userId: string,
  id: string,
  patch: UpdateJobContactBody,
): Promise<JobContactRecord | null> {
  if (hasPostgresConnection()) {
    return postgresStore.updateJobContact(userId, id, patch);
  }

  return runExclusive(async () => {
    const all = await ensureLoaded();
    const index = all.findIndex((c) => c.userId === userId && c.id === id);
    if (index === -1) return null;

    const existing = all[index]!;
    let updatedEvidence = existing.evidence;
    if (patch.evidence !== undefined) {
      const normalized = postgresStore.normalizeEvidence(patch.evidence);
      if (normalized.length === 0) {
        throw new Error('Every contact must carry at least 1 public evidence URL');
      }
      updatedEvidence = normalized;
    }

    const now = new Date().toISOString();
    const updated: JobContactRecord = {
      ...existing,
      name: patch.name !== undefined ? patch.name.trim() : existing.name,
      roleTitle: patch.roleTitle !== undefined ? patch.roleTitle.trim() : existing.roleTitle,
      evidence: updatedEvidence,
      relevance: patch.relevance !== undefined ? patch.relevance : existing.relevance,
      email: patch.email !== undefined ? patch.email : existing.email,
      linkedinUrl: patch.linkedinUrl !== undefined ? patch.linkedinUrl : existing.linkedinUrl,
      status: patch.status || existing.status,
      notes: patch.notes !== undefined ? patch.notes : existing.notes,
      updatedAt: now,
    };

    all[index] = updated;
    await persist();
    return clone(updated);
  });
}

export async function deleteJobContact(userId: string, id: string): Promise<boolean> {
  if (hasPostgresConnection()) {
    return postgresStore.deleteJobContact(userId, id);
  }

  return runExclusive(async () => {
    const all = await ensureLoaded();
    const index = all.findIndex((c) => c.userId === userId && c.id === id);
    if (index === -1) return false;

    all.splice(index, 1);
    await persist();
    return true;
  });
}

export async function _resetContactStoreForTests(initial: JobContactRecord[] = []) {
  cache = clone(initial);
  loadPromise = null;
  await persist();
}

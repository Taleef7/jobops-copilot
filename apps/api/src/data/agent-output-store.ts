import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hasPostgresConnection } from '@/lib/postgres';
import * as postgresStore from '@/data/agent-output-store.postgres';
import type { AgentKind, AgentOutputRecord } from '@/data/agent-output-store.postgres';

export type { AgentKind, AgentOutputRecord } from '@/data/agent-output-store.postgres';

interface StoredAgentOutput extends AgentOutputRecord {
  id: string;
  userId: string;
}

let cache: StoredAgentOutput[] | null = null;
let loadPromise: Promise<StoredAgentOutput[]> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function dataDir() {
  return join(process.cwd(), 'data');
}

function dataFile() {
  return join(dataDir(), 'agent-outputs.json');
}

async function load(): Promise<StoredAgentOutput[]> {
  await mkdir(dataDir(), { recursive: true });
  try {
    const raw = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid agent-output store contents');
    }
    cache = parsed as StoredAgentOutput[];
  } catch {
    cache = [];
    await persist();
  }
  return cache;
}

async function ensureLoaded(): Promise<StoredAgentOutput[]> {
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

function toPublic(record: StoredAgentOutput): AgentOutputRecord {
  return {
    jobId: record.jobId,
    kind: record.kind,
    payload: record.payload,
    modelUsed: record.modelUsed,
    createdAt: record.createdAt,
  };
}

export async function saveAgentOutput(
  userId: string,
  jobId: string,
  kind: AgentKind,
  payload: unknown,
  modelUsed?: string,
): Promise<AgentOutputRecord | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.saveAgentOutput(userId, jobId, kind, payload, modelUsed);
  }
  return runExclusive(async () => {
    const list = await ensureLoaded();
    const index = list.findIndex((entry) => entry.jobId === jobId && entry.kind === kind);
    const record: StoredAgentOutput = {
      id: index >= 0 ? list[index]!.id : randomUUID(),
      userId,
      jobId,
      kind,
      payload: clone(payload),
      modelUsed,
      createdAt: new Date().toISOString(),
    };
    if (index >= 0) list[index] = record;
    else list.push(record);
    await persist();
    return toPublic(record);
  });
}

export async function listAgentOutputs(userId: string, jobId: string): Promise<AgentOutputRecord[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listAgentOutputs(userId, jobId);
  }
  const list = await ensureLoaded();
  return list
    .filter((entry) => entry.userId === userId && entry.jobId === jobId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((entry) => toPublic(clone(entry)));
}

export function resetAgentOutputStoreForTests() {
  cache = null;
  loadPromise = null;
  mutationQueue = Promise.resolve();
}

/**
 * Best-effort persistence for a successful agent run: stores the output and
 * NEVER throws (a save failure must not break the user's result). `save` is
 * injectable for tests.
 */
export async function persistAgentRun(
  userId: string,
  jobId: string,
  kind: AgentKind,
  result: unknown,
  save: typeof saveAgentOutput = saveAgentOutput,
): Promise<void> {
  try {
    const candidate = (result as { model_used?: unknown }).model_used;
    const modelUsed = typeof candidate === 'string' ? candidate : undefined;
    await save(userId, jobId, kind, result, modelUsed);
  } catch (error) {
    console.error('[agents] failed to persist output', error);
  }
}

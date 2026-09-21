import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApplicationAnswer, UpsertApplicationAnswerBody } from '@/types';
import { hasPostgresConnection } from '@/lib/postgres';
import * as postgresStore from '@/data/application-answer-store.postgres';

export { hashQuestion } from '@/data/application-answer-store.postgres';

let cache: ApplicationAnswer[] | null = null;
let loadPromise: Promise<ApplicationAnswer[]> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function dataDir() {
  return join(process.cwd(), 'data');
}

function dataFile() {
  return join(dataDir(), 'application-answers.json');
}

async function load(): Promise<ApplicationAnswer[]> {
  await mkdir(dataDir(), { recursive: true });
  try {
    const raw = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid application-answers store contents');
    }
    cache = parsed as ApplicationAnswer[];
  } catch {
    cache = [];
    await persist();
  }
  return cache;
}

async function ensureLoaded(): Promise<ApplicationAnswer[]> {
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

export async function listApplicationAnswers(userId: string): Promise<ApplicationAnswer[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listApplicationAnswers(userId);
  }
  const all = await ensureLoaded();
  return clone(
    all
      .filter((a) => a.userId === userId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
  );
}

export async function findApplicationAnswer(
  userId: string,
  questionTextOrHash: string,
): Promise<ApplicationAnswer | undefined> {
  if (hasPostgresConnection()) {
    return postgresStore.findApplicationAnswer(userId, questionTextOrHash);
  }
  const isHash = /^[a-f0-9]{64}$/i.test(questionTextOrHash);
  const qHash = isHash
    ? questionTextOrHash.toLowerCase()
    : postgresStore.hashQuestion(questionTextOrHash);

  const all = await ensureLoaded();
  const match = all.find((a) => a.userId === userId && a.questionHash === qHash);
  return match ? clone(match) : undefined;
}

export async function upsertApplicationAnswer(
  userId: string,
  body: UpsertApplicationAnswerBody,
): Promise<ApplicationAnswer> {
  if (hasPostgresConnection()) {
    return postgresStore.upsertApplicationAnswer(userId, body);
  }
  return runExclusive(async () => {
    const all = await ensureLoaded();
    const qHash = body.questionHash || postgresStore.hashQuestion(body.questionText);
    const existingIndex = all.findIndex((a) => a.userId === userId && a.questionHash === qHash);

    const now = new Date().toISOString();
    if (existingIndex >= 0) {
      const existing = all[existingIndex]!;
      const updated: ApplicationAnswer = {
        ...existing,
        questionText: body.questionText.trim(),
        answer: body.answer.trim(),
        ats: body.ats !== undefined ? body.ats : existing.ats,
        updatedAt: now,
      };
      all[existingIndex] = updated;
      await persist();
      return clone(updated);
    }

    const created: ApplicationAnswer = {
      id: randomUUID(),
      userId,
      questionHash: qHash,
      questionText: body.questionText.trim(),
      answer: body.answer.trim(),
      ats: body.ats ?? undefined,
      createdAt: now,
      updatedAt: now,
    };
    all.unshift(created);
    await persist();
    return clone(created);
  });
}

export async function deleteApplicationAnswer(userId: string, id: string): Promise<boolean> {
  if (hasPostgresConnection()) {
    return postgresStore.deleteApplicationAnswer(userId, id);
  }
  return runExclusive(async () => {
    const all = await ensureLoaded();
    const idx = all.findIndex((a) => a.userId === userId && a.id === id);
    if (idx < 0) return false;
    all.splice(idx, 1);
    await persist();
    return true;
  });
}

export async function _resetApplicationAnswerStoreForTests(initial: ApplicationAnswer[] = []) {
  cache = clone(initial);
  loadPromise = null;
  await persist();
}

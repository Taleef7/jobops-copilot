import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WeeklyReportRecord } from '@/types';
import { hasPostgresConnection } from '@/lib/postgres';
import * as postgresStore from '@/data/report-store.postgres';
import { seedWeeklyReports } from '@/data/mock-store';

let reportsCache: WeeklyReportRecord[] | null = null;
let loadPromise: Promise<WeeklyReportRecord[]> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function dataDir() {
  return join(process.cwd(), 'data');
}

function dataFile() {
  return join(dataDir(), 'weekly-reports.json');
}

function seedState(): WeeklyReportRecord[] {
  return clone(seedWeeklyReports);
}

function sortReports(reports: WeeklyReportRecord[]) {
  return [...reports].sort(
    (left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
      Date.parse(right.weekEnd) - Date.parse(left.weekEnd) ||
      Date.parse(right.weekStart) - Date.parse(left.weekStart),
  );
}

async function loadReports(): Promise<WeeklyReportRecord[]> {
  await mkdir(dataDir(), { recursive: true });

  try {
    const raw = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error('Invalid weekly report store contents');
    }

    reportsCache = parsed as WeeklyReportRecord[];
  } catch {
    reportsCache = seedState();
    await persistReports();
  }

  return reportsCache;
}

async function ensureLoaded(): Promise<WeeklyReportRecord[]> {
  if (reportsCache) {
    return reportsCache;
  }

  loadPromise ??= loadReports();
  return loadPromise;
}

async function persistReports() {
  if (!reportsCache) {
    return;
  }

  await mkdir(dataDir(), { recursive: true });
  await writeFile(dataFile(), `${JSON.stringify(reportsCache, null, 2)}\n`, 'utf8');
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

export async function listWeeklyReports(): Promise<WeeklyReportRecord[]> {
  if (hasPostgresConnection()) {
    return postgresStore.listWeeklyReports();
  }

  const reports = await ensureLoaded();
  return sortReports(clone(reports));
}

export async function getLatestWeeklyReport(): Promise<WeeklyReportRecord | undefined> {
  const reports = await listWeeklyReports();
  return reports[0];
}

export async function saveWeeklyReport(report: WeeklyReportRecord): Promise<WeeklyReportRecord> {
  if (hasPostgresConnection()) {
    return postgresStore.saveWeeklyReport(report);
  }

  return runExclusive(async () => {
    const reports = await ensureLoaded();
    const reportIndex = reports.findIndex(
      (entry) => entry.weekStart === report.weekStart && entry.weekEnd === report.weekEnd,
    );
    const savedReport: WeeklyReportRecord =
      reportIndex >= 0
        ? {
            ...clone(report),
            id: reports[reportIndex]!.id,
          }
        : clone(report);

    if (reportIndex >= 0) {
      reports[reportIndex] = savedReport;
    } else {
      reports.unshift(savedReport);
    }

    reportsCache = sortReports(reports);
    await persistReports();
    return clone(savedReport);
  });
}

export function resetWeeklyReportStoreForTests() {
  reportsCache = null;
  loadPromise = null;
  mutationQueue = Promise.resolve();
}

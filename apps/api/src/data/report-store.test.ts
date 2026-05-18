import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { WeeklyReportRecord } from '@/types';
import {
  listWeeklyReports,
  resetWeeklyReportStoreForTests,
  saveWeeklyReport,
} from './report-store';

function makeReport(overrides: Partial<WeeklyReportRecord> = {}): WeeklyReportRecord {
  return {
    id: 'report-test',
    weekStart: '2026-05-18',
    weekEnd: '2026-05-24',
    jobsDiscovered: 4,
    jobsShortlisted: 2,
    jobsApplied: 1,
    outreachDrafted: 3,
    outreachSent: 1,
    responsesReceived: 1,
    interviews: 1,
    commonMissingSkills: ['n8n', 'Blob Storage'],
    recommendations: ['Send the drafted outreach.', 'Add a Blob Storage export.'],
    reportMarkdown: '# Weekly report\n\nSeed summary.',
    createdAt: '2026-05-24T18:00:00.000Z',
    ...overrides,
  };
}

function snapshotCwd() {
  return process.cwd();
}

test('loads the seeded weekly report into the current data directory', async () => {
  const originalCwd = snapshotCwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-weekly-report-'));

  try {
    process.chdir(tempDir);
    resetWeeklyReportStoreForTests();

    const reports = await listWeeklyReports();

    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.id, '44444444-4444-4444-8444-444444444444');
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('upserts reports by week range and keeps the latest version first', async () => {
  const originalCwd = snapshotCwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-weekly-report-'));

  try {
    process.chdir(tempDir);
    resetWeeklyReportStoreForTests();

    const firstSave = await saveWeeklyReport(makeReport({ createdAt: '2026-05-24T18:00:00.000Z' }));
    const updatedSave = await saveWeeklyReport(
      makeReport({
        jobsApplied: 2,
        recommendations: ['Review the higher-priority shortlist first.'],
        reportMarkdown: '# Weekly report\n\nUpdated summary.',
        createdAt: '2026-05-24T19:30:00.000Z',
      }),
    );

    const reports = await listWeeklyReports();
    const latest = reports[0];
    assert.ok(latest);
    assert.equal(firstSave.weekStart, updatedSave.weekStart);
    assert.equal(reports.filter((report) => report.weekStart === updatedSave.weekStart).length, 1);
    assert.equal(latest.weekStart, updatedSave.weekStart);
    assert.equal(latest.jobsApplied, 2);
    assert.equal(latest.createdAt, '2026-05-24T19:30:00.000Z');
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

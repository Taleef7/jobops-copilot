import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { exportWeeklyReportMarkdown } from '@/lib/report-export';
import type { WeeklyReportRecord } from '@/types';

function sampleReport(): WeeklyReportRecord {
  return {
    id: 'report-1',
    weekStart: '2026-05-18',
    weekEnd: '2026-05-24',
    jobsDiscovered: 1,
    jobsShortlisted: 1,
    jobsApplied: 0,
    outreachDrafted: 0,
    outreachSent: 0,
    responsesReceived: 0,
    interviews: 0,
    commonMissingSkills: [],
    recommendations: [],
    reportMarkdown: '# Weekly report\n',
    createdAt: new Date().toISOString(),
  };
}

// QA·C: the prod App Service filesystem is read-only (WEBSITE_RUN_FROM_PACKAGE=1), so the
// best-effort local write must never bubble up as a 500 — report generation must succeed
// and return the DB-backed API export URL.
test('exportWeeklyReportMarkdown returns a URL (no throw) when the local write fails', async () => {
  const originalCwd = process.cwd();
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const container = process.env.AZURE_STORAGE_CONTAINER_NAME;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-export-readonly-'));

  try {
    delete process.env.AZURE_STORAGE_CONNECTION_STRING; // force the no-blob local path
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;
    process.chdir(tempDir);
    // Block `data/report-exports` by planting a FILE where the dir must be created,
    // so mkdir(recursive) fails with EEXIST — a stand-in for the read-only prod FS.
    await mkdir(join(tempDir, 'data'));
    await writeFile(join(tempDir, 'data', 'report-exports'), 'not a directory');

    const url = await exportWeeklyReportMarkdown(sampleReport(), {
      publicBaseUrl: 'https://jobops-api.example.net',
    });

    assert.equal(url, 'https://jobops-api.example.net/api/reports/report-1/export');
  } finally {
    process.chdir(originalCwd);
    if (conn === undefined) delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    else process.env.AZURE_STORAGE_CONNECTION_STRING = conn;
    if (container === undefined) delete process.env.AZURE_STORAGE_CONTAINER_NAME;
    else process.env.AZURE_STORAGE_CONTAINER_NAME = container;
    await rm(tempDir, { recursive: true, force: true });
  }
});

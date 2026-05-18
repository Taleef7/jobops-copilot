import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeeklyReportRecord } from './weekly-report';

test('keeps empty weekly reports scoped to the requested window', () => {
  const report = buildWeeklyReportRecord([], {
    week_start: '2026-06-01',
    week_end: '2026-06-07',
  });

  assert.equal(report.jobsDiscovered, 0);
  assert.equal(report.jobsShortlisted, 0);
  assert.equal(report.jobsApplied, 0);
  assert.equal(report.outreachDrafted, 0);
  assert.equal(report.outreachSent, 0);
  assert.equal(report.responsesReceived, 0);
  assert.equal(report.interviews, 0);
  assert.deepEqual(report.commonMissingSkills, []);
  assert.match(report.recommendations[0] ?? '', /No jobs were discovered in this window/);
  assert.match(report.reportMarkdown, /2026-06-01 to 2026-06-07/);
  assert.match(report.reportMarkdown, /No jobs were discovered in this window/);
});

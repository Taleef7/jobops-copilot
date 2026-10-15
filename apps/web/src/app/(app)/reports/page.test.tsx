import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderPageOnServer } from '@/test/time-zones';
import type { WeeklyReport } from '@/types/job';

const report: WeeklyReport = {
  id: 'report-1',
  weekStart: '2026-10-05',
  weekEnd: '2026-10-11',
  jobsDiscovered: 4,
  jobsShortlisted: 2,
  jobsApplied: 1,
  outreachDrafted: 1,
  outreachSent: 0,
  responsesReceived: 0,
  interviews: 0,
  commonMissingSkills: [],
  recommendations: [],
  reportMarkdown: '',
  // Oct 12 in UTC; 9:30 pm on Oct 11 in New York, the browser's zone in these tests.
  createdAt: '2026-10-12T01:30:00.000Z',
};

vi.mock('@/lib/job-data', () => ({ loadJobs: vi.fn(async () => ({ jobs: [], error: null })) }));
vi.mock('@/lib/report-data', () => ({ loadWeeklyReports: vi.fn(async () => ({ reports: [report], error: null })) }));

import ReportsPage from './page';

// #412: the page is a server component, so "Generated" was the server's (UTC) day.
it("shows when a report was generated in the browser's time zone, and its week as saved", async () => {
  const html = await renderPageOnServer(() => ReportsPage());
  expect(html).not.toContain('Oct 12, 2026');

  render(await ReportsPage());
  expect(screen.getByText(/^Generated/)).toHaveTextContent('Generated Oct 11, 2026');
  expect(screen.getByText('Oct 5, 2026 – Oct 11, 2026')).toBeInTheDocument();
});

import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderPageOnServer } from '@/test/time-zones';
import type { Job } from '@/types/job';

const job: Job = {
  id: 'job-1',
  source: 'manual',
  company: 'Acme Pay',
  title: 'Backend Engineer',
  location: 'New York, NY',
  employmentType: 'Full-time',
  workplaceType: 'hybrid',
  // In UTC, Oct 1 and Oct 16; in New York, the browser's zone in these tests, Sep 30 and Oct 15.
  datePosted: '2026-10-01T01:30:00.000Z',
  discoveredAt: '2026-10-01T02:00:00.000Z',
  descriptionText: '',
  status: 'shortlisted',
  priority: 'high',
  fitScore: 81,
  nextAction: 'Follow up with the recruiter',
  nextActionDue: '2026-10-16T02:00:00.000Z',
  analysis: null,
  outreach: [],
};

vi.mock('@/lib/job-data', () => ({ loadJob: vi.fn(async () => ({ job, error: null })) }));
vi.mock('@/lib/api', () => ({
  fetchProfile: vi.fn(async () => null),
  fetchAgentOutputs: vi.fn(async () => []),
  fetchJobResumeVersions: vi.fn(async () => []),
  fetchJobApplicationPack: vi.fn(async () => null),
  fetchJobContacts: vi.fn(async () => []),
}));
vi.mock('next/navigation', () => ({ notFound: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
// The page's interactive panels have their own tests; this one is about the page's own dates.
vi.mock('@/components/job-analysis-actions', () => ({ JobAnalysisActions: () => null }));
vi.mock('@/components/job-agents-panel', () => ({ JobAgentsPanel: () => null }));
vi.mock('@/components/job-edit-panel', () => ({ JobEditPanel: () => null }));
vi.mock('@/components/job-outreach-actions', () => ({ JobOutreachActions: () => null }));
vi.mock('@/components/application-pack-view', () => ({ ApplicationPackView: () => null }));
vi.mock('@/components/job-contacts-panel', () => ({ JobContactsPanel: () => null }));
vi.mock('@/components/tailored-resume-review', () => ({ TailoredResumeReview: () => null }));

import JobDetailPage from './page';

const page = () => JobDetailPage({ params: Promise.resolve({ jobId: 'job-1' }) });

// #412: the page is a server component, so its dates were the server's (UTC) day.
it("shows the posted and follow-up days in the browser's time zone", async () => {
  const html = await renderPageOnServer(page);
  expect(html).not.toContain('Oct 1, 2026');
  expect(html).not.toContain('Oct 16, 2026');

  render(await page());
  const snapshot = screen.getByRole('heading', { name: 'Snapshot' }).parentElement!;
  expect(within(snapshot).getByText('Sep 30, 2026')).toBeInTheDocument();
  expect(within(snapshot).getByText('Oct 15, 2026')).toBeInTheDocument();
});

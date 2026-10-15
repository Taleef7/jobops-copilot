import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPageOnServer } from '@/test/time-zones';
import type { Job } from '@/types/job';

const { loadJob, api, scoreMounts } = vi.hoisted(() => ({
  scoreMounts: [] as string[],
  loadJob: vi.fn(async (): Promise<{ job: unknown; error: string | null }> => ({ job: undefined, error: null })),
  api: {
    fetchProfile: vi.fn(async () => null),
    fetchAgentOutputs: vi.fn(async () => []),
    fetchJobResumeVersions: vi.fn(async () => []),
    fetchJobApplicationPack: vi.fn(async () => null),
    fetchJobContacts: vi.fn(async () => []),
  },
}));
vi.mock('@/lib/job-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/job-data')>()),
  loadJob,
}));
vi.mock('@/lib/api', () => api);
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
// The page's interactive panels have their own tests.
vi.mock('@/components/job-analysis-actions', async () => {
  const { useEffect } = await import('react');
  return {
    JobAnalysisActions: ({ jobId }: { jobId: string }) => {
      useEffect(() => {
        scoreMounts.push(jobId);
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    },
  };
});
vi.mock('@/components/job-edit-panel', () => ({ JobEditPanel: () => null }));
vi.mock('@/components/job-outreach-actions', () => ({ JobOutreachActions: () => null }));
vi.mock('@/components/job-agents-panel', () => ({ JobAgentsPanel: () => null }));
vi.mock('@/components/tailored-resume-review', () => ({ TailoredResumeReview: () => null }));
vi.mock('@/components/application-pack-view', () => ({ ApplicationPackView: () => null }));
vi.mock('@/components/job-contacts-panel', () => ({ JobContactsPanel: () => null }));

import JobDetailPage, { generateMetadata } from './page';

afterEach(() => {
  vi.clearAllMocks();
  loadJob.mockImplementation(async () => ({ job: undefined, error: null }));
  scoreMounts.length = 0;
});

const params = (jobId: string) => ({ params: Promise.resolve({ jobId }) });
const ID = '7f1c2a9e-3b4d-4e5f-8a6b-0c1d2e3f4a5b';

// #353: `/jobs/not-a-real-id` asked the API for the job and its outputs, versions, pack and
// contacts, and took 12.5 s on live to say "not found". A job id is a UUID.
it('is not found for a malformed id, without asking the API', async () => {
  await expect(JobDetailPage(params('not-a-real-id'))).rejects.toThrow('NEXT_NOT_FOUND');

  expect(loadJob).not.toHaveBeenCalled();
  for (const fetcher of Object.values(api)) expect(fetcher).not.toHaveBeenCalled();
});

it('titles a malformed id without asking the API', async () => {
  expect(await generateMetadata(params('not-a-real-id'))).toEqual({ title: 'Job detail' });
  expect(loadJob).not.toHaveBeenCalled();
});

it('asks the API about a well-formed id, and is not found when there is no such job', async () => {
  await expect(JobDetailPage(params(ID))).rejects.toThrow('NEXT_NOT_FOUND');
  expect(loadJob).toHaveBeenCalledWith(ID);
});

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: ID,
    source: 'lever',
    company: 'Jobot',
    title: 'Backend Engineer',
    location: 'Austin, TX',
    employmentType: 'Full-time',
    workplaceType: 'hybrid',
    discoveredAt: '2026-10-01T00:00:00.000Z',
    descriptionText: 'Build APIs.',
    status: 'discovered',
    priority: 'medium',
    fitScore: null,
    nextAction: '',
    analysis: null,
    outreach: [],
    ...overrides,
  };
}

// #353 (from C2, SPEC "posting link"): the job page had no way back to the posting.
it('links to the posting from the header, in a new tab', async () => {
  loadJob.mockResolvedValueOnce({ job: makeJob({ jobUrl: 'https://jobs.lever.co/jobot/123' }), error: null });
  render(await JobDetailPage(params(ID)));

  const link = screen.getByRole('link', { name: /open posting/i });
  expect(link).toHaveAttribute('href', 'https://jobs.lever.co/jobot/123');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

it('has no posting link without a web address to open', async () => {
  for (const jobUrl of [undefined, 'javascript:alert(1)', 'not a url']) {
    loadJob.mockResolvedValueOnce({ job: makeJob({ jobUrl }), error: null });
    const { unmount } = render(await JobDetailPage(params(ID)));

    expect(screen.getByRole('heading', { name: 'Backend Engineer' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open posting/i })).not.toBeInTheDocument();
    unmount();
  }
});

// Score fit's one-at-a-time guard belongs to one job: another job gets its own instance,
// so a run for the last job can't block the next one's (#353).
it('gives each job its own Score fit', async () => {
  const other = '0b9e5c1d-2f3a-4b5c-8d6e-7f8091a2b3c4';
  loadJob.mockResolvedValueOnce({ job: makeJob(), error: null });
  const { rerender } = render(await JobDetailPage(params(ID)));
  loadJob.mockResolvedValueOnce({ job: makeJob({ id: other, title: 'Platform Engineer' }), error: null });
  rerender(await JobDetailPage(params(other)));

  expect(screen.getByRole('heading', { name: 'Platform Engineer' })).toBeInTheDocument();
  expect(scoreMounts).toEqual([ID, other]);
});

// #412: the page's own dates, in the browser's time zone.
describe('dates', () => {
  // In UTC, Oct 1 and Oct 16; in New York, the browser's zone in these tests, Sep 30 and Oct 15.
  const dated = makeJob({
    company: 'Acme Pay',
    location: 'New York, NY',
    datePosted: '2026-10-01T01:30:00.000Z',
    discoveredAt: '2026-10-01T02:00:00.000Z',
    status: 'shortlisted',
    priority: 'high',
    fitScore: 81,
    nextAction: 'Follow up with the recruiter',
    nextActionDue: '2026-10-16T02:00:00.000Z',
  });
  const page = () => JobDetailPage(params(ID));

  // #412: the page is a server component, so its dates were the server's (UTC) day.
  it("shows the posted and follow-up days in the browser's time zone", async () => {
    loadJob.mockResolvedValue({ job: dated, error: null });
    const html = await renderPageOnServer(page);
    expect(html).not.toContain('Oct 1, 2026');
    expect(html).not.toContain('Oct 16, 2026');

    render(await page());
    const snapshot = screen.getByRole('heading', { name: 'Snapshot' }).parentElement!;
    expect(within(snapshot).getByText('Sep 30, 2026')).toBeInTheDocument();
    expect(within(snapshot).getByText('Oct 15, 2026')).toBeInTheDocument();
  });

  // date_posted is timestamptz, so a source that gives only the day reaches the web as UTC midnight.
  it('shows a posting day stored as UTC midnight as that day', async () => {
    loadJob.mockResolvedValue({ job: { ...dated, datePosted: '2026-06-01T00:00:00.000Z' }, error: null });
    render(await page());
    const snapshot = screen.getByRole('heading', { name: 'Snapshot' }).parentElement!;
    expect(within(snapshot).getByText('Jun 1, 2026')).toBeInTheDocument();
  });

  // A cleared next action reads back as ''.
  it('shows a dash for a job with no next action', async () => {
    loadJob.mockResolvedValue({ job: { ...dated, nextAction: '' }, error: null });
    render(await page());
    const snapshot = screen.getByRole('heading', { name: 'Snapshot' }).parentElement!;
    expect(within(snapshot).getByText('Next action').nextElementSibling).toHaveTextContent(/^—$/);
  });
});

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
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

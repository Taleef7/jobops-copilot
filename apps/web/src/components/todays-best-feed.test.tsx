import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { updateJob } from '@/lib/api';
import type { FeedItem, FeedResult, Job } from '@/types/job';
import { TodaysBestFeed } from './todays-best-feed';

vi.mock('@/lib/api', () => ({
  fetchRankedFeed: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
  updateJob: vi.fn().mockResolvedValue({}),
}));

function makeJob(id: string, company: string, title: string): Job {
  return {
    id,
    source: 'lever',
    company,
    title,
    location: 'Remote',
    employmentType: 'Full-time',
    workplaceType: 'remote',
    discoveredAt: new Date().toISOString(),
    descriptionText: 'Description',
    status: 'discovered',
    priority: 'high',
    fitScore: 85,
    nextAction: 'Action',
    analysis: {
      requiredSkills: [],
      preferredSkills: [],
      matchedSkills: ['Python', 'TypeScript'],
      missingSkills: [],
      atsKeywords: [],
      fitSummary: 'Summary',
      recommendedResumeAngle: 'Angle',
      applyRecommendation: 'apply',
      confidenceScore: 80,
      modelUsed: 'mock',
      subSignals: {
        skills_match: 85,
        title_seniority: 80,
        salary_fit: 90,
        sponsorship_likelihood: 90,
      },
    },
    outreach: [],
  };
}

const mockFeedItems: FeedItem[] = [
  {
    job: makeJob('job-1', 'Stripe', 'Senior Backend Engineer'),
    fitScore: 85,
    adjustedScore: 95,
    subSignals: { skills_match: 90, title_seniority: 85, salary_fit: 90, sponsorship_likelihood: 90 },
    rankReasons: ['High skill match', 'Previous interview conversion'],
  },
  {
    job: makeJob('job-2', 'Airbnb', 'Staff Infrastructure Engineer'),
    fitScore: 80,
    adjustedScore: 80,
    subSignals: { skills_match: 80, title_seniority: 80, salary_fit: 85, sponsorship_likelihood: 80 },
    rankReasons: ['Seniority match'],
  },
];

const mockFeedResult: FeedResult = {
  items: mockFeedItems,
  total: 2,
  limit: 50,
  offset: 0,
};

it('renders feed items and summary count', () => {
  render(<TodaysBestFeed initialFeed={mockFeedResult} />);

  expect(screen.getByText(/2 curated opportunities/i)).toBeInTheDocument();
  expect(screen.getByText('Senior Backend Engineer')).toBeInTheDocument();
  expect(screen.getByText('Staff Infrastructure Engineer')).toBeInTheDocument();
  expect(screen.getByText('Stripe')).toBeInTheDocument();
  expect(screen.getByText('Airbnb')).toBeInTheDocument();
});

it('filters items client-side by query string', async () => {
  const user = userEvent.setup();
  render(<TodaysBestFeed initialFeed={mockFeedResult} />);

  const searchInput = screen.getByRole('searchbox', { name: /filter today's best/i });
  await user.type(searchInput, 'stripe');

  expect(screen.getByText('Senior Backend Engineer')).toBeInTheDocument();
  expect(screen.queryByText('Staff Infrastructure Engineer')).not.toBeInTheDocument();
});

it('shows empty state when no items match the search', async () => {
  const user = userEvent.setup();
  render(<TodaysBestFeed initialFeed={mockFeedResult} />);

  const searchInput = screen.getByRole('searchbox', { name: /filter today's best/i });
  await user.type(searchInput, 'nonexistentcompanyname');

  expect(screen.getByText(/No curated jobs match these filters/i)).toBeInTheDocument();
});

// #353: Pass archived the job but left its card on top with an "Archived" chip, so the next
// Shortlist or Pass on the "first" card hit the same job again.
it('removes a passed card and moves focus to the next one', async () => {
  const user = userEvent.setup();
  render(<TodaysBestFeed initialFeed={mockFeedResult} />);

  const first = screen.getByRole('link', { name: 'Senior Backend Engineer' }).closest('[data-slot="card"]') as HTMLElement;
  await user.click(within(first).getByRole('button', { name: /pass/i }));

  await waitFor(() => expect(screen.queryByText('Senior Backend Engineer')).not.toBeInTheDocument());
  expect(updateJob).toHaveBeenCalledWith('job-1', { status: 'archived' });
  expect(screen.getByText(/1 curated opportunity/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Staff Infrastructure Engineer' })).toHaveFocus();
});

it('keeps a shortlisted card in the feed', async () => {
  const user = userEvent.setup();
  render(<TodaysBestFeed initialFeed={mockFeedResult} />);

  const first = screen.getByRole('link', { name: 'Senior Backend Engineer' }).closest('[data-slot="card"]') as HTMLElement;
  await user.click(within(first).getByRole('button', { name: /shortlist/i }));

  await waitFor(() => expect(within(first).getByText(/✓ Shortlisted/)).toBeInTheDocument());
  expect(screen.getByText('Senior Backend Engineer')).toBeInTheDocument();
  expect(screen.getByText(/2 curated opportunities/i)).toBeInTheDocument();
});

it('moves focus to a card still there when two Passes overlap', async () => {
  const user = userEvent.setup();
  const third: FeedItem = { ...mockFeedItems[1]!, job: makeJob('job-3', 'Figma', 'Platform Engineer') };
  render(<TodaysBestFeed initialFeed={{ ...mockFeedResult, items: [...mockFeedItems, third], total: 3 }} />);
  const answers: (() => void)[] = [];
  vi.mocked(updateJob).mockImplementation(() => new Promise((resolve) => answers.push(() => resolve({} as never))));
  const card = (title: string) => screen.getByRole('link', { name: title }).closest('[data-slot="card"]') as HTMLElement;

  try {
    // Pass the second card, then the third; the third one's answer comes back first.
    await user.click(within(card('Staff Infrastructure Engineer')).getByRole('button', { name: /pass/i }));
    await user.click(within(card('Platform Engineer')).getByRole('button', { name: /pass/i }));
    await act(async () => answers[1]!());
    await act(async () => answers[0]!());

    expect(screen.getByText(/1 curated opportunity/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Senior Backend Engineer' })).toHaveFocus();
  } finally {
    vi.mocked(updateJob).mockResolvedValue({} as never);
  }
});

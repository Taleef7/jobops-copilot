import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
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
  render(<TodaysBestFeed initialFeed={mockFeedResult} source="api" />);

  expect(screen.getByText(/2 curated opportunities/i)).toBeInTheDocument();
  expect(screen.getByText('Senior Backend Engineer')).toBeInTheDocument();
  expect(screen.getByText('Staff Infrastructure Engineer')).toBeInTheDocument();
  expect(screen.getByText('Stripe')).toBeInTheDocument();
  expect(screen.getByText('Airbnb')).toBeInTheDocument();
});

it('filters items client-side by query string', async () => {
  const user = userEvent.setup();
  render(<TodaysBestFeed initialFeed={mockFeedResult} source="api" />);

  const searchInput = screen.getByRole('searchbox', { name: /filter today's best/i });
  await user.type(searchInput, 'stripe');

  expect(screen.getByText('Senior Backend Engineer')).toBeInTheDocument();
  expect(screen.queryByText('Staff Infrastructure Engineer')).not.toBeInTheDocument();
});

it('shows empty state when no items match the search', async () => {
  const user = userEvent.setup();
  render(<TodaysBestFeed initialFeed={mockFeedResult} source="api" />);

  const searchInput = screen.getByRole('searchbox', { name: /filter today's best/i });
  await user.type(searchInput, 'nonexistentcompanyname');

  expect(screen.getByText(/No curated jobs match these filters/i)).toBeInTheDocument();
});

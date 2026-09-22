import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { FeedItem, Job } from '@/types/job';
import { FeedCard } from './feed-card';

// Mock the API call
vi.mock('@/lib/api', () => ({
  updateJob: vi.fn().mockResolvedValue({}),
}));

function makeFeedItem(overrides?: Partial<Job>): FeedItem {
  const job: Job = {
    id: 'test-job-1',
    source: 'lever',
    company: 'Stripe',
    title: 'Staff Infrastructure Engineer',
    location: 'San Francisco, CA',
    employmentType: 'Full-time',
    workplaceType: 'hybrid',
    datePosted: new Date(Date.now() - 3600 * 1000 * 4).toISOString(), // 4h ago
    discoveredAt: new Date().toISOString(),
    descriptionText: 'Sample description',
    status: 'discovered',
    priority: 'high',
    fitScore: 82,
    salaryMin: 180000,
    salaryMax: 220000,
    salaryCurrency: 'USD',
    seniority: 'lead',
    sponsorLikelihood: 'likely',
    nextAction: 'Review',
    analysis: {
      requiredSkills: ['Kubernetes', 'Go'],
      preferredSkills: ['Terraform'],
      matchedSkills: ['Kubernetes', 'Go'],
      missingSkills: [],
      atsKeywords: [],
      fitSummary: 'Great role fit',
      recommendedResumeAngle: 'Focus on scale',
      applyRecommendation: 'apply',
      confidenceScore: 90,
      modelUsed: 'feed-curator',
      subSignals: {
        skills_match: 90,
        title_seniority: 85,
        salary_fit: 88,
        sponsorship_likelihood: 95,
      },
    },
    outreach: [],
    ...overrides,
  };

  return {
    job,
    fitScore: 82,
    adjustedScore: 92, // +10 adjustment
    subSignals: {
      skills_match: 90,
      title_seniority: 85,
      salary_fit: 88,
      sponsorship_likelihood: 95,
    },
    rankReasons: ['Previous interview conversion at Stripe (+10)', 'Fresh posting (<24h)'],
  };
}

it('renders role title, company, salary, and badges correctly', () => {
  const item = makeFeedItem();
  render(<FeedCard item={item} />);

  expect(screen.getByText('Staff Infrastructure Engineer')).toBeInTheDocument();
  expect(screen.getByText('Stripe')).toBeInTheDocument();
  expect(screen.getByText(/San Francisco, CA/)).toBeInTheDocument();
  expect(screen.getByText('$180k – $220k')).toBeInTheDocument();
  expect(screen.getByText(/New today/i)).toBeInTheDocument();
  expect(screen.getByText(/H-1B Sponsor/i)).toBeInTheDocument();
});

it('renders rank score delta and rank reasons explanation', () => {
  const item = makeFeedItem();
  render(<FeedCard item={item} />);

  // Rank delta (+10)
  expect(screen.getByText('+10')).toBeInTheDocument();

  // Rank reasons
  expect(screen.getByText(/Why today's best:/i)).toBeInTheDocument();
  expect(screen.getByText(/Previous interview conversion at Stripe/i)).toBeInTheDocument();
  expect(screen.getByText(/Fresh posting/i)).toBeInTheDocument();
});

it('renders all 4 sub-signals score chips', () => {
  const item = makeFeedItem();
  render(<FeedCard item={item} />);

  expect(screen.getByText('Skills')).toBeInTheDocument();
  expect(screen.getByText('90%')).toBeInTheDocument();
  expect(screen.getByText('Role Fit')).toBeInTheDocument();
  expect(screen.getByText('85%')).toBeInTheDocument();
  expect(screen.getByText('Salary Fit')).toBeInTheDocument();
  expect(screen.getByText('88%')).toBeInTheDocument();
  expect(screen.getByText('Sponsorship')).toBeInTheDocument();
  expect(screen.getByText('95%')).toBeInTheDocument();
});

it('calls onStatusChange and updates UI when shortlisting', async () => {
  const user = userEvent.setup();
  const item = makeFeedItem();
  const onStatusChange = vi.fn();

  render(<FeedCard item={item} onStatusChange={onStatusChange} />);

  const shortlistBtn = screen.getByRole('button', { name: /shortlist/i });
  await user.click(shortlistBtn);

  expect(onStatusChange).toHaveBeenCalledWith('test-job-1', 'shortlisted');
  expect(screen.getByText(/✓ Shortlisted/i)).toBeInTheDocument();
});

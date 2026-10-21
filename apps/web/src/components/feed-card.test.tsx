import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { hydrateInBrowser, renderOnServer } from '@/test/time-zones';
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

// #353: the Source link opens only a web address, like the job page's posting link.
it('links Source only to a web address, written out in full', () => {
  const { unmount } = render(<FeedCard item={makeFeedItem({ jobUrl: 'http:boards.example.com/jobs/1' })} />);
  expect(screen.getByRole('link', { name: /source/i })).toHaveAttribute('href', 'http://boards.example.com/jobs/1');
  unmount();

  render(<FeedCard item={makeFeedItem({ jobUrl: 'javascript:alert(1)' })} />);
  expect(screen.queryByRole('link', { name: /source/i })).not.toBeInTheDocument();
});

// #412: the server renders in UTC, where 1:30 am on Oct 1 is still 9:30 pm on Sep 30 in New
// York, the browser's zone in these tests. Two different days are a hydration error (React #418).
it("shows the posted day in the browser's time zone, without a hydration error", async () => {
  const card = <FeedCard item={makeFeedItem({ datePosted: '2026-10-01T01:30:00.000Z' })} />;
  const { container, hydrationErrors } = await hydrateInBrowser(renderOnServer(card), card);

  expect(hydrationErrors).not.toHaveBeenCalled();
  expect(container).toHaveTextContent('Posted Sep 30, 2026');
});

// The server and the browser read the clock seconds apart, either side of "New today"'s 24 hours.
it('decides "New today" in the browser, without a hydration error', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const card = <FeedCard item={makeFeedItem({ datePosted: '2026-10-14T12:00:00.000Z' })} />;
    vi.setSystemTime(new Date('2026-10-15T11:59:58.000Z'));
    const html = renderOnServer(card);
    vi.setSystemTime(new Date('2026-10-15T12:00:03.000Z'));
    const { container, hydrationErrors } = await hydrateInBrowser(html, card);

    expect(hydrationErrors).not.toHaveBeenCalled();
    expect(within(container).queryByText('New today')).not.toBeInTheDocument();
    expect(within(container).getByText('Recent')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

// date_posted is timestamptz, so a source that gives only the day reaches the web as UTC midnight.
it('shows a posting day stored as UTC midnight as that day', () => {
  const { container } = render(<FeedCard item={makeFeedItem({ datePosted: '2026-06-01T00:00:00.000Z' })} />);
  expect(container).toHaveTextContent('Posted Jun 1, 2026');
});

it('shows when a job was discovered as the instant it was, even at UTC midnight', () => {
  const item = makeFeedItem({ datePosted: undefined, discoveredAt: '2026-06-01T00:00:00.000Z' });
  const { container } = render(<FeedCard item={item} />);
  expect(container).toHaveTextContent('Discovered May 31, 2026');
});

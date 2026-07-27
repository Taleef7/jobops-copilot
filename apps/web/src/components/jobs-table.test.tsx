import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import type { Job } from '@/types/job';
import { chooseOption } from '@/test/select';
import { JobsTable } from './jobs-table';

function makeJob(overrides: Partial<Job>): Job {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    source: 'manual',
    company: 'Acme',
    title: 'Engineer',
    location: 'Remote',
    employmentType: 'Full-time',
    workplaceType: 'remote',
    discoveredAt: '2026-01-01T00:00:00.000Z',
    descriptionText: '',
    status: 'discovered',
    priority: 'medium',
    fitScore: 70,
    nextAction: '',
    analysis: {
      requiredSkills: [],
      preferredSkills: [],
      matchedSkills: [],
      missingSkills: [],
      atsKeywords: [],
      fitSummary: '',
      recommendedResumeAngle: '',
      applyRecommendation: '',
      confidenceScore: 0,
      modelUsed: 'mock',
    },
    outreach: [],
    ...overrides,
  };
}

const jobs = [
  makeJob({ company: 'Northwind Labs', title: 'AI Automation Engineer' }),
  makeJob({ company: 'BeaconOps', title: 'Solutions Consultant' }),
];

it('seeds the search from initialQuery and filters to matching jobs', () => {
  render(<JobsTable jobs={jobs} initialQuery="northwind" />);

  expect(screen.getByRole('searchbox', { name: /search jobs/i })).toHaveValue('northwind');
  expect(screen.getByText('AI Automation Engineer')).toBeInTheDocument();
  expect(screen.queryByText('Solutions Consultant')).not.toBeInTheDocument();
});

it('shows all jobs when initialQuery is empty', () => {
  render(<JobsTable jobs={jobs} initialQuery="" />);

  expect(screen.getByText('AI Automation Engineer')).toBeInTheDocument();
  expect(screen.getByText('Solutions Consultant')).toBeInTheDocument();
});

it('filters by recency on datePosted (falling back to discoveredAt)', async () => {
  const now = Date.now();
  const recent = makeJob({
    company: 'RecentCo',
    title: 'Fresh Role',
    datePosted: new Date(now - 2 * 3600_000).toISOString(),
  });
  const stale = makeJob({
    company: 'StaleCo',
    title: 'Old Role',
    datePosted: new Date(now - 10 * 24 * 3600_000).toISOString(),
  });

  const user = userEvent.setup();
  render(<JobsTable jobs={[recent, stale]} />);

  expect(screen.getByText('Fresh Role')).toBeInTheDocument();
  expect(screen.getByText('Old Role')).toBeInTheDocument();

  await chooseOption(user, /filter by recency/i, /last 24h/i);

  expect(screen.getByText('Fresh Role')).toBeInTheDocument();
  expect(screen.queryByText('Old Role')).not.toBeInTheDocument();
});

it('marks an estimated (local-prerank) job and lists its matched skills', () => {
  const job = makeJob({
    company: 'EstimateCo',
    title: 'Estimated Role',
    analysis: {
      requiredSkills: [],
      preferredSkills: [],
      matchedSkills: ['TypeScript', 'React'],
      missingSkills: [],
      atsKeywords: [],
      fitSummary: '',
      recommendedResumeAngle: '',
      applyRecommendation: '',
      confidenceScore: 0,
      modelUsed: 'local-prerank',
    },
  });

  render(<JobsTable jobs={[job]} />);

  expect(screen.getAllByText(/estimated/i).some((el) => el.textContent === 'Estimated')).toBe(true);
  expect(screen.getByText(/TypeScript/)).toBeInTheDocument();
});

// jsdom has no layout engine, so this cannot assert the measured width. It
// guards the mechanism instead: below `lg` the rows must switch to a grid and
// stop inheriting the table's `whitespace-nowrap`, which is what let the table
// reach 1783px at a 375px viewport. Geometry was verified in a real browser.
it('renders rows as stacked cards below the lg breakpoint', () => {
  render(<JobsTable jobs={jobs} />);

  const row = screen.getByText('AI Automation Engineer').closest('tr');
  expect(row).not.toBeNull();
  expect(row).toHaveClass('max-lg:grid');
  // `ring`, not `border`: TableBody's `[&_tr:last-child]:border-0` would strip
  // the last card's outline in a specificity tie.
  expect(row).toHaveClass('max-lg:ring-1');

  const identityCell = row!.querySelector('td');
  expect(identityCell).toHaveClass('max-lg:whitespace-normal');
});

// A find-and-replace moved the header to `lg` but missed the body cell, whose
// classes weren't contiguous. That left the value reappearing at `md` while its
// header stayed hidden — an auto-placed, unlabelled third grid row on tablets.
it('reveals the next-action column at the same breakpoint as its header', () => {
  render(<JobsTable jobs={jobs} />);

  const headers = screen.getAllByRole('columnheader');
  const nextActionHeader = headers.find((h) => h.textContent === 'Next action');
  const row = screen.getByText('AI Automation Engineer').closest('tr');
  const nextActionCell = row!.querySelectorAll('td')[4];

  expect(nextActionHeader).toHaveClass('lg:table-cell');
  expect(nextActionCell).toHaveClass('lg:table-cell');
  expect(nextActionCell).not.toHaveClass('md:table-cell');
});

// Card mode drops the header row, and `display: grid` drops the table
// semantics that would have associated it anyway — so these values would be
// announced with nothing to say what they describe.
it('labels the status and priority values for screen readers in card mode', () => {
  render(<JobsTable jobs={jobs} />);

  for (const label of ['Status:', 'Priority:']) {
    const [node] = screen.getAllByText(label);
    expect(node).toHaveClass('sr-only');
    // Removed at lg, where the real column header does the job.
    expect(node).toHaveClass('lg:hidden');
  }
});

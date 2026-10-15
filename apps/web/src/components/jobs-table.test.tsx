import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import type { Job } from '@/types/job';
import { chooseOption } from '@/test/select';
import { hydrateInBrowser, renderOnServer } from '@/test/time-zones';
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

// #349: a job has no analysis until a real score; the row says so instead of showing a
// made-up one (every new job used to get a keyword "analysis" at creation).
it('says a job is not analysed yet when it has no analysis', () => {
  render(<JobsTable jobs={[makeJob({ id: 'fresh', title: 'Fresh role', company: 'Newco', analysis: null })]} initialQuery="" />);

  expect(screen.getByText('Fresh role')).toBeInTheDocument();
  expect(screen.getByText('Not analysed yet')).toBeInTheDocument();
});

// #353: a search from the header says it is filtering, with a way back to every job.
it('shows a "Filtered by" chip for a search from the URL, with Clear', async () => {
  const user = userEvent.setup();
  render(<JobsTable jobs={jobs} initialQuery="northwind" />);

  const chip = screen.getByText(/filtered by/i).closest('p');
  expect(chip).toHaveTextContent('Filtered by “northwind”');
  expect(screen.getByRole('link', { name: 'Clear' })).toHaveAttribute('href', '/jobs?tab=pipeline');

  // Once the search box says something else, the chip would be wrong.
  await user.type(screen.getByRole('searchbox', { name: /search jobs/i }), ' labs');
  expect(screen.queryByText(/filtered by/i)).not.toBeInTheDocument();
});

it('shows no chip without a search from the URL', () => {
  render(<JobsTable jobs={jobs} initialQuery="" />);

  expect(screen.queryByText(/filtered by/i)).not.toBeInTheDocument();
});

// #412: the server renders in UTC, where these are Oct 1 and Oct 16; in New York, the browser's
// zone in these tests, they're the evenings of Sep 30 and Oct 15. Two days are a hydration error.
it("shows the posted and follow-up days in the browser's time zone, without a hydration error", async () => {
  const table = (
    <JobsTable
      jobs={[
        makeJob({ title: 'Posted late', datePosted: '2026-10-01T01:30:00.000Z' }),
        makeJob({ title: 'Due late', nextActionDue: '2026-10-16T02:00:00.000Z' }),
      ]}
      initialQuery=""
    />
  );
  const { container, hydrationErrors } = await hydrateInBrowser(renderOnServer(table), table);

  expect(hydrationErrors).not.toHaveBeenCalled();
  expect(container).toHaveTextContent('Posted Sep 30, 2026');
  expect(within(container).getByText('Oct 15, 2026')).toBeInTheDocument();
});

// date_posted is timestamptz, so a source that gives only the day reaches the web as UTC midnight.
it('shows a posting day stored as UTC midnight as that day', () => {
  const { container } = render(<JobsTable jobs={[makeJob({ datePosted: '2026-06-01T00:00:00.000Z' })]} initialQuery="" />);
  expect(container).toHaveTextContent('Posted Jun 1, 2026');
});

// A cleared next action reads back as '': the column shows the follow-up date instead.
it('shows the follow-up date when a job has no next action', () => {
  render(<JobsTable jobs={[makeJob({ nextAction: '', nextActionDue: '2026-10-20T13:00:00.000Z' })]} initialQuery="" />);
  expect(screen.getByText('Oct 20, 2026')).toBeInTheDocument();
});

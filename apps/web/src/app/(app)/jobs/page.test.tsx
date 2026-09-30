import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import JobsPage from './page';

const { loadJobs, loadRankedFeed } = vi.hoisted(() => ({
  loadJobs: vi.fn(async (): Promise<{ jobs: unknown[]; error: string | null }> => ({ jobs: [], error: null })),
  loadRankedFeed: vi.fn(async (): Promise<{ feed: unknown; error: string | null }> => ({
    feed: { items: [], total: 0, limit: 50, offset: 0 },
    error: null,
  })),
}));
vi.mock('@/lib/job-data', () => ({ loadJobs, loadRankedFeed }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

// Capture the query JobsTable is given so we can assert it is always a string.
vi.mock('@/components/jobs-table', () => ({
  JobsTable: ({ initialQuery }: { initialQuery: string }) => (
    <div data-testid="initial-query">{JSON.stringify(initialQuery)}</div>
  ),
}));

// The discovery panel is an interactive client component (router + API calls);
// stub it so this test stays focused on query-param normalization.
vi.mock('@/components/saved-searches', () => ({
  SavedSearchesManager: () => <div data-testid="saved-searches" />,
}));

it('normalizes a repeated q param (string[]) to its first value', async () => {
  const ui = await JobsPage({ searchParams: Promise.resolve({ q: ['backend', 'remote'] }) });
  render(ui);

  expect(screen.getByTestId('initial-query')).toHaveTextContent('"backend"');
});

it('passes a single q param through unchanged', async () => {
  const ui = await JobsPage({ searchParams: Promise.resolve({ q: 'backend' }) });
  render(ui);

  expect(screen.getByTestId('initial-query')).toHaveTextContent('"backend"');
});

it('defaults to an empty string when q is absent', async () => {
  const ui = await JobsPage({ searchParams: Promise.resolve({}) });
  render(ui);

  expect(screen.getByTestId('initial-query')).toHaveTextContent('""');
});

// #349: when the jobs can't load, the page says so with a retry, never sample jobs.
it('shows the error state, not a job list, when the jobs fail to load', async () => {
  loadJobs.mockResolvedValueOnce({ jobs: [], error: 'API unreachable' });
  const ui = await JobsPage({ searchParams: Promise.resolve({}) });
  render(ui);

  expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your jobs");
  expect(screen.getByRole('alert')).toHaveTextContent('API unreachable');
  expect(screen.queryByTestId('initial-query')).not.toBeInTheDocument();
});

it("keeps the pipeline and shows the feed's error when only the feed fails", async () => {
  loadRankedFeed.mockResolvedValueOnce({ feed: null, error: 'The API took too long to answer.' });
  const ui = await JobsPage({ searchParams: Promise.resolve({}) });
  render(ui);

  expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load today's best");
  expect(screen.getByRole('alert')).toHaveTextContent('The API took too long to answer.');
  expect(screen.getByTestId('initial-query')).toBeInTheDocument();
});

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import JobsPage from './page';

vi.mock('@/lib/job-data', () => ({
  loadJobs: vi.fn(async () => ({ jobs: [], source: 'api' })),
}));

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

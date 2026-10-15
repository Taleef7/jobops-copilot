import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@/lib/job-data', () => ({ loadJobs: async () => ({ jobs: [], error: null }) }));
vi.mock('@/components/load-sample-data-button', () => ({ LoadSampleDataButton: () => null }));

import DashboardPage from './page';

// #356: plain words, and the spec's empty state (docs/SPEC.md, Pipeline). Saving a job
// parses, scores and drafts nothing (#349).
it('says plainly what the page is and what to do with no jobs', async () => {
  const { container } = render(await DashboardPage());

  expect(screen.getByText('Your job search at a glance.')).toBeInTheDocument();
  expect(screen.getByText('No jobs yet')).toBeInTheDocument();
  expect(screen.getByText('Add one by pasting a posting or its URL.')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/operations|the AI will|\bAI\b/i);
});

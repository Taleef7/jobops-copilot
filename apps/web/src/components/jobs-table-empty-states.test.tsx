import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import type { Job } from '@/types/job';
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

it('shows a "No jobs yet" empty state (not a filter hint) and hides the toolbar when there are zero jobs', () => {
  render(<JobsTable jobs={[]} />);

  expect(screen.getByText('No jobs yet')).toBeInTheDocument();
  expect(screen.queryByText('No matching jobs')).not.toBeInTheDocument();
  // The filter toolbar is pointless with no data.
  expect(screen.queryByRole('searchbox', { name: /search jobs/i })).not.toBeInTheDocument();
  // No "Showing 0 of 0 jobs" noise.
  expect(screen.queryByText(/showing .* jobs/i)).not.toBeInTheDocument();
});

it('shows the "No matching jobs" filter hint when jobs exist but none match the query', async () => {
  const user = userEvent.setup();
  render(<JobsTable jobs={[makeJob({ company: 'Northwind' })]} />);

  await user.type(screen.getByRole('searchbox', { name: /search jobs/i }), 'zzz-no-match');

  expect(screen.getByText('No matching jobs')).toBeInTheDocument();
  expect(screen.queryByText('No jobs yet')).not.toBeInTheDocument();
});

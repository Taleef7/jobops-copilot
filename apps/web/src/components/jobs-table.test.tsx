import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
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

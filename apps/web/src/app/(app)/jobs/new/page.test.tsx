import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@/components/job-create-form', () => ({ JobCreateForm: () => <form data-testid="job-create-form" /> }));

import AddJobPage from './page';

// #356: saving a job doesn't extract skills or score it (#349); the page says what does happen.
it('says what saving does, and that the fit is run on the job page', () => {
  const { container } = render(<AddJobPage />);

  expect(screen.getByRole('heading', { name: 'Add a job' })).toBeInTheDocument();
  expect(screen.getByText(/score fit/i)).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/AI extracts|scores your fit|analy[sz]ed|CRM/i);
});

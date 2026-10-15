import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@/components/job-create-form', () => ({ JobCreateForm: () => <form data-testid="job-create-form" /> }));

import AddJobPage from './page';

// #355: the page promised that saving pulls out the skills and scores the fit, into "the
// CRM". It says what the form does: read a link or a posting, then save.
it('says what adding a job does, in plain words', () => {
  const { container } = render(<AddJobPage />);

  expect(screen.getByRole('heading', { name: 'Add a job' })).toBeInTheDocument();
  expect(screen.getByText('Paste a job link or the posting. Check the details, then save.')).toBeInTheDocument();
  expect(screen.getByTestId('job-create-form')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/AI\s+extracts|scores your fit|analy[sz]ed|CRM/i);
});

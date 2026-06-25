import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const { extractJobFromUrl, createJob } = vi.hoisted(() => ({
  extractJobFromUrl: vi.fn(),
  createJob: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/api', () => ({
  extractJobFromUrl,
  createJob,
  ApiRequestError: class ApiRequestError extends Error {},
}));

import { JobCreateForm } from './job-create-form';

afterEach(() => {
  vi.clearAllMocks();
});

it('disables Autofill until the URL is a valid http(s) URL', async () => {
  const user = userEvent.setup();
  render(<JobCreateForm />);

  const autofill = screen.getByRole('button', { name: /autofill/i });
  expect(autofill).toBeDisabled();

  await user.type(screen.getByLabelText(/job url/i), 'https://boards.greenhouse.io/x/jobs/1');
  expect(autofill).toBeEnabled();
});

it('populates the form from a successful extraction', async () => {
  extractJobFromUrl.mockResolvedValue({
    title: 'AI Engineer',
    company: 'Pebble',
    location: 'Remote',
    descriptionText: 'Build agents.',
    workplaceType: 'remote',
    source: 'jsonld',
  });
  const user = userEvent.setup();
  render(<JobCreateForm />);

  await user.type(screen.getByLabelText(/job url/i), 'https://x/y');
  await user.click(screen.getByRole('button', { name: /autofill/i }));

  await waitFor(() => expect(screen.getByLabelText(/company/i)).toHaveValue('Pebble'));
  expect(screen.getByLabelText(/job title/i)).toHaveValue('AI Engineer');
  expect(screen.getByLabelText(/job description/i)).toHaveValue('Build agents.');
});

it('shows a manual-entry fallback when nothing could be extracted', async () => {
  extractJobFromUrl.mockResolvedValue({ source: 'none' });
  const user = userEvent.setup();
  render(<JobCreateForm />);

  await user.type(screen.getByLabelText(/job url/i), 'https://x/y');
  await user.click(screen.getByRole('button', { name: /autofill/i }));

  expect(await screen.findByText(/couldn.t read that posting/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/job title/i)).toHaveValue('');
});

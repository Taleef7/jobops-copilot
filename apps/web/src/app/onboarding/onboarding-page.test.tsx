import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const { saveResumeText, uploadResumeFile, createSavedSearch, runDiscovery } = vi.hoisted(() => ({
  saveResumeText: vi.fn(() => Promise.resolve(null)),
  uploadResumeFile: vi.fn(() => Promise.resolve(null)),
  createSavedSearch: vi.fn(() => Promise.resolve({ id: 's1' })),
  runDiscovery: vi.fn(() => Promise.resolve({ inserted: 3, skipped: 0, source: 'adzuna' })),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('@/lib/api', () => ({ saveResumeText, uploadResumeFile, createSavedSearch, runDiscovery }));

import OnboardingPage from './page';

afterEach(() => {
  vi.clearAllMocks();
});

it('shows an inline alert (in addition to the toast) when continuing with no resume', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  expect(screen.queryByRole('alert')).toBeNull();
  await user.click(screen.getByRole('button', { name: /continue/i }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/add your resume to continue/i);
});

it('advances to the target-roles step after a resume is saved, then discovers and routes to jobs', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  await user.click(screen.getByRole('tab', { name: /paste text/i }));
  await user.type(screen.getByPlaceholderText(/paste your resume text/i), 'Senior TypeScript engineer.');
  await user.click(screen.getByRole('button', { name: /continue/i }));

  const roleInput = await screen.findByLabelText(/role or keywords/i);
  await user.type(roleInput, 'AI Engineer');
  await user.click(screen.getByRole('button', { name: /find matching jobs/i }));

  await waitFor(() => expect(createSavedSearch).toHaveBeenCalledWith({
    query: 'AI Engineer',
    location: undefined,
    remoteOnly: false,
  }));
  expect(runDiscovery).toHaveBeenCalledOnce();
  await waitFor(() => expect(push).toHaveBeenCalledWith('/jobs'));
});

it('requires a role/keyword before discovering on step 2', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  await user.click(screen.getByRole('tab', { name: /paste text/i }));
  await user.type(screen.getByPlaceholderText(/paste your resume text/i), 'Engineer.');
  await user.click(screen.getByRole('button', { name: /continue/i }));

  await screen.findByLabelText(/role or keywords/i);
  await user.click(screen.getByRole('button', { name: /find matching jobs/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/add at least one role or keyword/i);
  expect(createSavedSearch).not.toHaveBeenCalled();
});

it('treats a "Remote" location as remote-only (the source ignores it as a place)', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  await user.click(screen.getByRole('tab', { name: /paste text/i }));
  await user.type(screen.getByPlaceholderText(/paste your resume text/i), 'Engineer.');
  await user.click(screen.getByRole('button', { name: /continue/i }));

  await user.type(await screen.findByLabelText(/role or keywords/i), 'AI Engineer');
  await user.type(screen.getByLabelText(/^location$/i), 'Remote');
  await user.click(screen.getByRole('button', { name: /find matching jobs/i }));

  await waitFor(() =>
    expect(createSavedSearch).toHaveBeenCalledWith({
      query: 'AI Engineer',
      location: undefined,
      remoteOnly: true,
    }),
  );
});

it('lets the user skip discovery and go to the dashboard', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  await user.click(screen.getByRole('tab', { name: /paste text/i }));
  await user.type(screen.getByPlaceholderText(/paste your resume text/i), 'Engineer.');
  await user.click(screen.getByRole('button', { name: /continue/i }));

  await screen.findByLabelText(/role or keywords/i);
  await user.click(screen.getByRole('button', { name: /skip for now/i }));

  expect(createSavedSearch).not.toHaveBeenCalled();
  await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'));
});

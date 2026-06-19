import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ saveResumeText: vi.fn(), uploadResumeFile: vi.fn() }));

import OnboardingPage from './page';

afterEach(() => {
  vi.clearAllMocks();
});

it('shows an inline alert (in addition to the toast) when continuing with no resume', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  // No alert before the user submits.
  expect(screen.queryByRole('alert')).toBeNull();

  await user.click(screen.getByRole('button', { name: /continue to dashboard/i }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/add your resume to continue/i);
  // The toast still fires too — inline is "in addition to", not a replacement.
  expect(toastError).toHaveBeenCalledOnce();
});

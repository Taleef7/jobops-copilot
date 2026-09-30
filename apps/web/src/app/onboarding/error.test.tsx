import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import OnboardingError from './error';

// #349: a crash in onboarding offers a retry and a way past it, never a dead end.
it('offers a retry and a skip to the dashboard', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const reset = vi.fn();
  const user = userEvent.setup();
  render(<OnboardingError error={new Error('boom')} reset={reset} />);

  expect(screen.getByRole('alert')).toHaveTextContent("Setup didn't load");
  await user.click(screen.getByRole('button', { name: /try again/i }));
  expect(reset).toHaveBeenCalledOnce();
  expect(screen.getByRole('link', { name: /skip for now/i })).toHaveAttribute('href', '/dashboard');
});

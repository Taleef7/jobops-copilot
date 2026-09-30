import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { ErrorState } from './error-state';

afterEach(() => vi.clearAllMocks());

// #349: a failure is shown where it happened, with the reason and a way to try again,
// instead of a toast that disappears or sample data that looks real.
it('shows the reason and retries through the callback', async () => {
  const onRetry = vi.fn();
  render(<ErrorState title="Couldn't score this job" message="The AI couldn't be reached. Try again in a moment." onRetry={onRetry} />);

  expect(screen.getByRole('alert')).toHaveTextContent("Couldn't score this job");
  expect(screen.getByRole('alert')).toHaveTextContent("The AI couldn't be reached.");
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it('reloads the page when it has no callback (server-rendered pages)', async () => {
  render(<ErrorState title="Couldn't load your jobs" message="API unreachable" />);

  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(refresh).toHaveBeenCalledTimes(1);
});

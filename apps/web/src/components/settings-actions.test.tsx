import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const { clearMyData, seedDemoData } = vi.hoisted(() => ({
  clearMyData: vi.fn(() => Promise.resolve()),
  seedDemoData: vi.fn(() => Promise.resolve()),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ clearMyData, seedDemoData, uploadResumeFile: vi.fn() }));

import { DemoDataActions } from './settings-actions';

afterEach(() => {
  vi.clearAllMocks();
});

it('does not clear data on the first click — it asks for confirmation', async () => {
  const user = userEvent.setup();
  render(<DemoDataActions />);

  await user.click(screen.getByRole('button', { name: /clear my data/i }));

  // Destructive call must NOT have fired yet.
  expect(clearMyData).not.toHaveBeenCalled();
  // A confirmation prompt is shown instead.
  expect(screen.getByRole('button', { name: /yes, delete everything/i })).toBeInTheDocument();
});

it('clears data only after the explicit confirm', async () => {
  const user = userEvent.setup();
  render(<DemoDataActions />);

  await user.click(screen.getByRole('button', { name: /clear my data/i }));
  await user.click(screen.getByRole('button', { name: /yes, delete everything/i }));

  expect(clearMyData).toHaveBeenCalledOnce();
});

it('cancelling the confirmation aborts the destructive action', async () => {
  const user = userEvent.setup();
  render(<DemoDataActions />);

  await user.click(screen.getByRole('button', { name: /clear my data/i }));
  await user.click(screen.getByRole('button', { name: /cancel/i }));

  expect(clearMyData).not.toHaveBeenCalled();
  // Back to the single, unconfirmed button.
  expect(screen.getByRole('button', { name: /clear my data/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /yes, delete everything/i })).not.toBeInTheDocument();
});

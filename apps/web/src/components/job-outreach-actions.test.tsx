import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const { draftOutreach } = vi.hoisted(() => ({ draftOutreach: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/api', () => ({
  draftOutreach,
  ApiRequestError: class ApiRequestError extends Error {},
}));

import { JobOutreachActions } from './job-outreach-actions';

afterEach(() => vi.clearAllMocks());

// #349: a failed draft says why, keeps what was typed, and can be retried as is.
it('shows the reason, keeps the form, and retries when drafting fails', async () => {
  draftOutreach.mockRejectedValueOnce(new Error('The AI service is unavailable right now. Try again in a moment.'));
  const user = userEvent.setup();
  render(<JobOutreachActions jobId="job-1" jobContext="Acme · Engineer" />);

  await user.type(screen.getByLabelText('Contact name'), 'Dana');
  await user.click(screen.getByRole('button', { name: /generate outreach/i }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent("Couldn't draft outreach");
  expect(alert).toHaveTextContent('The AI service is unavailable right now.');
  expect(screen.getByLabelText('Contact name')).toHaveValue('Dana');

  draftOutreach.mockResolvedValueOnce({
    subject: 'Hello',
    draft_text: 'Hi Dana',
    safety_notes: '',
    gmail_draft_status: 'skipped',
  });
  await user.click(screen.getByRole('button', { name: /try again/i }));
  expect(draftOutreach).toHaveBeenCalledTimes(2);
  expect(draftOutreach).toHaveBeenLastCalledWith(expect.objectContaining({ contactName: 'Dana' }));
  expect(await screen.findByText('Hi Dana')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

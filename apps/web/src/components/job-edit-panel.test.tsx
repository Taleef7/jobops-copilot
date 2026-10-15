import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { hydrateInBrowser, renderOnServer } from '@/test/time-zones';
import type { Job } from '@/types/job';

const { updateJob, toastError } = vi.hoisted(() => ({ updateJob: vi.fn(), toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/api', () => {
  class ApiRequestError extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  }
  return { updateJob, ApiRequestError };
});

import { ApiRequestError } from '@/lib/api';
import { JobEditPanel } from './job-edit-panel';

afterEach(() => vi.clearAllMocks());

const job = {
  id: 'job-1',
  status: 'discovered',
  priority: 'medium',
  notes: '',
  nextAction: '',
  nextActionDue: null,
} as unknown as Job;

// #349: a save that times out says so and keeps what was typed, so nothing is lost.
it('keeps the typed notes and shows the reason when a save times out', async () => {
  updateJob.mockRejectedValueOnce(
    new ApiRequestError('The API took too long to answer. Try again in a moment.', 408),
  );
  const user = userEvent.setup();
  render(<JobEditPanel job={job} />);

  await user.type(screen.getByLabelText('Notes'), 'Call Dana on Monday');
  await user.click(screen.getByRole('button', { name: /save changes/i }));

  expect(toastError).toHaveBeenCalledWith('The API took too long to answer. Try again in a moment.');
  expect(screen.getByLabelText('Notes')).toHaveValue('Call Dana on Monday');
  expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled();
});

// #412: the server renders in UTC and the browser in New York (these tests' zone), where
// 2 am UTC on Oct 16 is 10 pm on Oct 15.
const dueJob = { ...job, nextActionDue: '2026-10-16T02:00:00.000Z' } as Job;

it("shows the follow-up in the browser's time zone, never the server's", async () => {
  const panel = <JobEditPanel job={dueJob} />;
  const html = renderOnServer(panel);
  expect(html).not.toContain('2026-10-16T02:00');

  const { container, hydrationErrors } = await hydrateInBrowser(html, panel);
  expect(hydrationErrors).not.toHaveBeenCalled();
  expect(within(container).getByLabelText('Follow-up due')).toHaveValue('2026-10-15T22:00');
});

it('a save that leaves the follow-up alone keeps its instant', async () => {
  updateJob.mockResolvedValueOnce({});
  const panel = <JobEditPanel job={dueJob} />;
  const { container } = await hydrateInBrowser(renderOnServer(panel), panel);

  await userEvent.setup().click(within(container).getByRole('button', { name: /save changes/i }));

  expect(updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ nextActionDue: '2026-10-16T02:00:00.000Z' }));
});

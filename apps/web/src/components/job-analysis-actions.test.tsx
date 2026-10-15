import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, type ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';

const { scoreFit } = vi.hoisted(() => ({
  scoreFit: vi.fn(() => Promise.resolve({ fit_score: 80 })),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/api', () => ({
  scoreFit,
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));

import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { ApiRequestError } from '@/lib/api';
import { JobAnalysisActions } from './job-analysis-actions';

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

it('offers a single "Score fit" action and no separate "Parse job" button', () => {
  render(<JobAnalysisActions jobId="job-1" />);

  expect(screen.getByRole('button', { name: /score fit/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /parse job/i })).not.toBeInTheDocument();
});

it('does not auto-score by default', () => {
  render(<JobAnalysisActions jobId="job-1" />);
  expect(scoreFit).not.toHaveBeenCalled();
});

it('auto-scores once on mount when the analysis is an estimate', async () => {
  render(<JobAnalysisActions jobId="job-1" autoScore />);
  await waitFor(() => expect(scoreFit).toHaveBeenCalledTimes(1));
  expect(scoreFit).toHaveBeenCalledWith({ jobId: 'job-1' });
});

it('does not auto-score again if it re-renders with autoScore still set', async () => {
  const { rerender } = render(<JobAnalysisActions jobId="job-1" autoScore />);
  await waitFor(() => expect(scoreFit).toHaveBeenCalledTimes(1));
  rerender(<JobAnalysisActions jobId="job-1" autoScore />);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(scoreFit).toHaveBeenCalledTimes(1);
});

it('auto-scores again when the same instance is reused for a different job', async () => {
  const { rerender } = render(<JobAnalysisActions jobId="job-1" autoScore />);
  await waitFor(() => expect(scoreFit).toHaveBeenCalledTimes(1));
  rerender(<JobAnalysisActions jobId="job-2" autoScore />);
  await waitFor(() => expect(scoreFit).toHaveBeenCalledTimes(2));
  expect(scoreFit).toHaveBeenLastCalledWith({ jobId: 'job-2' });
});

// #353: `isScoring` disables the button only after a re-render, so it can't stop a second
// call made in the same tick.
it('sends one request for two clicks in the same tick', () => {
  scoreFit.mockReturnValueOnce(new Promise(() => {}));
  render(<JobAnalysisActions jobId="job-1" />);
  const button = screen.getByRole('button', { name: /score fit/i });

  act(() => {
    button.click();
    button.click();
  });

  expect(scoreFit).toHaveBeenCalledTimes(1);
});

/** Server-render, then hydrate and click Score fit in one tick, as during a slow page load. */
async function hydrateAndClick(ui: ReactElement) {
  const container = document.createElement('div');
  container.innerHTML = renderToString(ui);
  document.body.appendChild(container);
  const button = container.querySelector('button')!;
  expect(button).toBeEnabled();
  let root: ReturnType<typeof hydrateRoot> | undefined;
  await act(async () => {
    root = hydrateRoot(container, ui);
    button.click();
  });
  return () => {
    act(() => root?.unmount());
    container.remove();
  };
}

// #353, the live double POST: the server renders an enabled "Score fit" for an estimated
// job. A click while the page hydrated ran alongside the automatic score, and both called
// the API.
it('sends one request when Score fit is clicked while the page hydrates and auto-scores', async () => {
  scoreFit.mockImplementation(() => new Promise(() => {}));
  const cleanup = await hydrateAndClick(<JobAnalysisActions jobId="job-1" autoScore />);
  try {
    expect(scoreFit).toHaveBeenCalledTimes(1);
  } finally {
    cleanup();
    scoreFit.mockImplementation(() => Promise.resolve({ fit_score: 80 }));
  }
});

// The click that joins the automatic score gets its answer: a failure isn't kept quiet.
it('shows why the automatic score failed when Score fit was clicked during it', async () => {
  let fail: (error: Error) => void = () => {};
  scoreFit.mockImplementation(() => new Promise((_resolve, reject) => (fail = reject)));
  const cleanup = await hydrateAndClick(<JobAnalysisActions jobId="job-1" autoScore />);
  try {
    await act(async () => fail(new ApiRequestError("The AI couldn't be reached. Try again in a moment.", 503)));

    expect(await screen.findByRole('alert')).toHaveTextContent("The AI couldn't be reached.");
    expect(scoreFit).toHaveBeenCalledTimes(1);
  } finally {
    cleanup();
    scoreFit.mockImplementation(() => Promise.resolve({ fit_score: 80 }));
  }
});

// #349: when the AI can't score, the reason stays on the page with a way to retry. It used
// to arrive as a made-up "estimated fit" instead.
it('shows why scoring failed, inline, and retries from there', async () => {
  scoreFit.mockRejectedValueOnce(new ApiRequestError("The AI couldn't be reached. Try again in a moment.", 503));
  render(<JobAnalysisActions jobId="job-1" />);

  await userEvent.click(screen.getByRole('button', { name: /score fit/i }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent("The AI couldn't be reached.");
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(scoreFit).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

// #355: "Save and run fit" on the Add job form opens the job with ?run=fit. The page starts
// one fit run, as if Score fit were clicked: through the same one-at-a-time guard, with its
// progress and result shown.
it('runs one Score fit when the job opens with ?run=fit, and says when it is saved', async () => {
  window.history.replaceState(null, '', '/jobs/job-run-1?run=fit');
  let answer: (value: { fit_score: number }) => void = () => {};
  scoreFit.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
  // StrictMode runs effects twice in development, as `next dev` does.
  const { rerender } = render(
    <StrictMode>
      <JobAnalysisActions jobId="job-run-1" runFit />
    </StrictMode>,
  );

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Scoring this job. This can take a moment.'));
  expect(screen.getByRole('button', { name: /scoring/i })).toBeDisabled();
  await act(async () => answer({ fit_score: 80 }));
  await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Fit score saved: 80/100'));
  expect(screen.getByRole('status')).toHaveTextContent('');
  rerender(
    <StrictMode>
      <JobAnalysisActions jobId="job-run-1" runFit />
    </StrictMode>,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(scoreFit).toHaveBeenCalledTimes(1);
  expect(scoreFit).toHaveBeenCalledWith({ jobId: 'job-run-1' });
  // A reload, or Back to this page, doesn't pay for another run.
  expect(window.location.pathname).toBe('/jobs/job-run-1');
  expect(window.location.search).toBe('');
});

it('shows why the fit run from ?run=fit failed, inline, with a retry', async () => {
  scoreFit.mockRejectedValueOnce(new ApiRequestError('Upload your résumé in Settings to get a fit read.', 400));
  render(<JobAnalysisActions jobId="job-run-2" runFit />);

  expect(await screen.findByRole('alert')).toHaveTextContent('Upload your résumé in Settings to get a fit read.');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  expect(scoreFit).toHaveBeenCalledTimes(1);
});

it('runs no Score fit on open without ?run=fit or an estimate', async () => {
  render(<JobAnalysisActions jobId="job-1" runFit={false} />);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(scoreFit).not.toHaveBeenCalled();
});

// #355 review: Back or Forward to /jobs/<id>?run=fit serves the cached page, still with
// runFit, after the address was cleaned. A job runs from ?run=fit once per page load.
it('runs ?run=fit once for a job, even when the page comes back from history', async () => {
  const first = render(<JobAnalysisActions jobId="job-back" runFit />);
  await waitFor(() => expect(scoreFit).toHaveBeenCalledTimes(1));
  first.unmount();

  render(<JobAnalysisActions jobId="job-back" runFit />);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(scoreFit).toHaveBeenCalledTimes(1);
});

// The live region stays in the accessibility tree when it's empty, so the first message is heard.
it('keeps the status line in place while idle', () => {
  render(<JobAnalysisActions jobId="job-1" />);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('');
  expect(status).not.toHaveClass('empty:hidden');
});

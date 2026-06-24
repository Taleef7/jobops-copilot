import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const { scoreFit } = vi.hoisted(() => ({
  scoreFit: vi.fn(() => Promise.resolve({ fit_score: 80 })),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/api', () => ({
  scoreFit,
  ApiRequestError: class ApiRequestError extends Error {},
}));

import { JobAnalysisActions } from './job-analysis-actions';

afterEach(() => {
  vi.clearAllMocks();
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

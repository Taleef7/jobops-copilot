import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
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

  // Score fit is the one analysis action (it parses + scores in one step).
  expect(screen.getByRole('button', { name: /score fit/i })).toBeInTheDocument();
  // "Parse job" is gone — it used to overwrite the scored analysis with a
  // fit-less heuristic, which is the bug this removes.
  expect(screen.queryByRole('button', { name: /parse job/i })).not.toBeInTheDocument();
});

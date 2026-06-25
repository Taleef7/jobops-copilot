import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentOutputItem } from '@/lib/api';

const { runInterviewPrep, runResearch, runSkillGap } = vi.hoisted(() => ({
  runInterviewPrep: vi.fn(),
  runResearch: vi.fn(),
  runSkillGap: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api', () => ({
  runInterviewPrep,
  runResearch,
  runSkillGap,
  ApiRequestError: class ApiRequestError extends Error {},
}));

import { JobAgentsPanel } from './job-agents-panel';

afterEach(() => {
  vi.clearAllMocks();
});

const interviewOutput: AgentOutputItem = {
  jobId: 'job-1',
  kind: 'interview_prep',
  modelUsed: 'gpt-test',
  createdAt: '2026-06-20T10:00:00.000Z',
  payload: {
    likely_questions: ['Tell me about a hard bug'],
    talking_points: ['Shipped the overhaul'],
    gaps_to_address: [],
    questions_to_ask: ['What does success look like?'],
  },
};

it('renders a persisted output immediately on mount', () => {
  render(<JobAgentsPanel jobId="job-1" initialOutputs={[interviewOutput]} />);

  expect(screen.getByText('Tell me about a hard bug')).toBeInTheDocument();
  expect(screen.queryByText(/run the interview prep agent/i)).not.toBeInTheDocument();
});

it('labels the action "Regenerate" when a persisted output is present', () => {
  render(<JobAgentsPanel jobId="job-1" initialOutputs={[interviewOutput]} />);

  expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^run agent$/i })).not.toBeInTheDocument();
});

it('labels the action "Run agent" with no persisted output', () => {
  render(<JobAgentsPanel jobId="job-1" />);

  expect(screen.getByRole('button', { name: /run agent/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /regenerate/i })).not.toBeInTheDocument();
});

it('shows a "Generated … · model" line for a persisted output', () => {
  render(<JobAgentsPanel jobId="job-1" initialOutputs={[interviewOutput]} />);

  const line = screen.getByText(/^Generated /);
  expect(line).toHaveTextContent('gpt-test');
});

it('regenerate calls the agent API and replaces the shown result', async () => {
  runInterviewPrep.mockResolvedValue({
    likely_questions: ['A fresh question'],
    talking_points: [],
    gaps_to_address: [],
    questions_to_ask: [],
    model_used: 'gpt-fresh',
  });

  render(<JobAgentsPanel jobId="job-1" initialOutputs={[interviewOutput]} />);
  await userEvent.click(screen.getByRole('button', { name: /regenerate/i }));

  await waitFor(() => expect(runInterviewPrep).toHaveBeenCalledWith({ jobId: 'job-1' }));
  expect(await screen.findByText('A fresh question')).toBeInTheDocument();
  expect(screen.queryByText('Tell me about a hard bug')).not.toBeInTheDocument();
});

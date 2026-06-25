import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { state, streamAssistantChat } = vi.hoisted(() => ({
  state: { pathname: '/dashboard' },
  streamAssistantChat: vi.fn(),
}));

vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ userId: 'u1', isLoaded: true }) }));
vi.mock('@/lib/assistant-chat', () => ({ streamAssistantChat }));

import { AssistantWidget } from './assistant-widget';

const STORAGE_KEY = 'jobops:assistant-chat';

beforeEach(() => {
  state.pathname = '/dashboard';
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

it('renders a launcher and opens the panel', async () => {
  render(<AssistantWidget />);
  const launcher = screen.getByRole('button', { name: /open assistant/i });
  await userEvent.click(launcher);
  expect(screen.getByRole('dialog', { name: /assistant/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/message the assistant/i)).toBeInTheDocument();
});

it('shows job-specific quick prompts on a job page', async () => {
  state.pathname = '/jobs/job-123';
  render(<AssistantWidget />);
  await userEvent.click(screen.getByRole('button', { name: /open assistant/i }));
  expect(screen.getByRole('button', { name: /what am i missing for this role/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /summarize my pipeline/i })).not.toBeInTheDocument();
});

it('shows general quick prompts off a job page', async () => {
  render(<AssistantWidget />);
  await userEvent.click(screen.getByRole('button', { name: /open assistant/i }));
  expect(screen.getByRole('button', { name: /summarize my pipeline/i })).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /what am i missing for this role/i }),
  ).not.toBeInTheDocument();
});

it('streams tokens into an assistant message and passes the jobId', async () => {
  state.pathname = '/jobs/job-123';
  streamAssistantChat.mockImplementation(async ({ onToken, onDone }) => {
    onToken('Hello ');
    onToken('there');
    onDone({ modelUsed: 'm' });
  });

  render(<AssistantWidget />);
  await userEvent.click(screen.getByRole('button', { name: /open assistant/i }));
  await userEvent.type(screen.getByLabelText(/message the assistant/i), 'hi');
  await userEvent.click(screen.getByRole('button', { name: /^send$/i }));

  expect(await screen.findByText('Hello there')).toBeInTheDocument();
  expect(screen.getByText('hi')).toBeInTheDocument();
  expect(streamAssistantChat).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-123' }));
});

it('persists the thread to sessionStorage scoped to the user', async () => {
  streamAssistantChat.mockImplementation(async ({ onToken, onDone }) => {
    onToken('Pipeline summary');
    onDone({});
  });

  render(<AssistantWidget />);
  await userEvent.click(screen.getByRole('button', { name: /open assistant/i }));
  await userEvent.click(screen.getByRole('button', { name: /summarize my pipeline/i }));
  await screen.findByText('Pipeline summary');

  const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '{}');
  expect(stored.userId).toBe('u1');
  expect(stored.messages.at(-1)).toEqual({ role: 'assistant', content: 'Pipeline summary' });
});

it('does not restore another user’s stored thread', async () => {
  window.sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ userId: 'someone-else', messages: [{ role: 'user', content: 'secret note' }] }),
  );

  render(<AssistantWidget />);
  await userEvent.click(screen.getByRole('button', { name: /open assistant/i }));

  expect(screen.queryByText('secret note')).not.toBeInTheDocument();
});

it('restores the current user’s stored thread on open', async () => {
  window.sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ userId: 'u1', messages: [{ role: 'assistant', content: 'welcome back' }] }),
  );

  render(<AssistantWidget />);
  await userEvent.click(screen.getByRole('button', { name: /open assistant/i }));

  expect(screen.getByText('welcome back')).toBeInTheDocument();
});

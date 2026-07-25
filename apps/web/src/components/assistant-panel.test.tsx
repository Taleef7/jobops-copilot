import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

import { AssistantPanel } from './assistant-panel';

/** Minimal fetch Response stand-in that streams pre-baked SSE frames. */
function fakeStreamResponse(frames: string[]) {
  const enc = new TextEncoder();
  const chunks = frames.map((f) => enc.encode(f));
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true, value: undefined },
      }),
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

it('streams run progress into a polite log region', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      fakeStreamResponse([
        'event: status\ndata: {"node":"parse","status":"ok"}\n\n',
        'event: status\ndata: {"node":"score","status":"ok"}\n\n',
      ]),
    ),
  );

  render(<AssistantPanel />);
  await userEvent.type(screen.getByPlaceholderText(/paste a job description/i), 'JD text');
  await userEvent.click(screen.getByRole('button', { name: /run assistant/i }));

  const parse = await screen.findByText(/parsing the job description/i);
  const log = screen.getByRole('log');
  expect(log).toContainElement(parse);
  expect(log).toHaveAttribute('aria-live', 'polite');
});

it('announces the drafted outreach in a live region', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      fakeStreamResponse([
        'event: status\ndata: {"node":"draft","status":"ok"}\n\n',
        'event: result\ndata: {"draft":{"draft_text":"Drafted hello"}}\n\n',
      ]),
    ),
  );

  render(<AssistantPanel />);
  await userEvent.type(screen.getByPlaceholderText(/paste a job description/i), 'JD text');
  await userEvent.click(screen.getByRole('button', { name: /run assistant/i }));

  const draft = await screen.findByText('Drafted hello');
  // The draft output must sit inside a live region so a screen reader hears it arrive.
  expect(draft.closest('[aria-live]')).not.toBeNull();
});

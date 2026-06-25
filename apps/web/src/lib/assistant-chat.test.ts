import { afterEach, expect, it, vi } from 'vitest';
import { streamAssistantChat } from './assistant-chat';

function sseResponse(frames: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

it('emits token then done on a clean stream', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    sseResponse([
      'event: token\ndata: {"text":"hel"}\n\n',
      'event: token\ndata: {"text":"lo"}\n\n',
      'event: done\ndata: {"model_used":"m"}\n\n',
    ]),
  );
  const onToken = vi.fn();
  const onDone = vi.fn();
  const onError = vi.fn();
  await streamAssistantChat({
    messages: [{ role: 'user', content: 'hi' }],
    onToken,
    onDone,
    onError,
  });
  expect(onToken.mock.calls.flat()).toEqual(['hel', 'lo']);
  expect(onDone).toHaveBeenCalledWith({ modelUsed: 'm' });
  expect(onError).not.toHaveBeenCalled();
});

it('treats an error frame as terminal — onError, never onDone', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    sseResponse([
      'event: token\ndata: {"text":"partial"}\n\n',
      'event: error\ndata: {"message":"boom"}\n\n',
      // A trailing done frame must be ignored once the stream has errored.
      'event: done\ndata: {}\n\n',
    ]),
  );
  const onToken = vi.fn();
  const onDone = vi.fn();
  const onError = vi.fn();
  await streamAssistantChat({
    messages: [{ role: 'user', content: 'hi' }],
    onToken,
    onDone,
    onError,
  });
  expect(onToken).toHaveBeenCalledWith('partial');
  expect(onError).toHaveBeenCalledWith('boom');
  expect(onDone).not.toHaveBeenCalled();
});

it('reports a non-OK response via onError', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ error: 'Daily limit reached' }), { status: 429 }),
  );
  const onToken = vi.fn();
  const onDone = vi.fn();
  const onError = vi.fn();
  await streamAssistantChat({
    messages: [{ role: 'user', content: 'hi' }],
    onToken,
    onDone,
    onError,
  });
  expect(onError).toHaveBeenCalledWith('Daily limit reached');
  expect(onDone).not.toHaveBeenCalled();
});

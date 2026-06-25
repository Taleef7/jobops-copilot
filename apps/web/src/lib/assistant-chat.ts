/**
 * Client for the conversational assistant stream (Phase 5 · global widget).
 *
 * POSTs to the dedicated streaming Next route and parses the SSE frames the
 * Express → Python chain emits: `token` (append text), `done` (final, carries
 * `model_used`), `error` (upstream failure). Non-OK responses (e.g. 429 budget,
 * 503 unavailable) surface through `onError` with the upstream message.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamAssistantChatOptions {
  messages: ChatMessage[];
  jobId?: string;
  signal?: AbortSignal;
  onToken: (text: string) => void;
  onDone: (meta: { modelUsed?: string }) => void;
  onError: (message: string) => void;
}

function parseFrame(frame: string): { event?: string; data: Record<string, unknown> } | null {
  const lines = frame.split('\n');
  const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
  const dataLine = lines.find((line) => line.startsWith('data:'))?.slice(5).trim();
  if (!event || !dataLine) return null;
  try {
    return { event, data: JSON.parse(dataLine) as Record<string, unknown> };
  } catch {
    return null;
  }
}

export async function streamAssistantChat({
  messages,
  jobId,
  signal,
  onToken,
  onDone,
  onError,
}: StreamAssistantChatOptions): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/assistant-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, jobId }),
      signal,
    });
  } catch {
    onError('The assistant is unreachable right now.');
    return;
  }

  if (!response.ok || !response.body) {
    let message =
      response.status === 503
        ? "The assistant isn't available right now."
        : 'The assistant request failed.';
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // non-JSON body — keep the default message
    }
    onError(message);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let doneEmitted = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const parsed = parseFrame(frame);
        if (!parsed) continue;
        if (parsed.event === 'token') {
          onToken(String(parsed.data.text ?? ''));
        } else if (parsed.event === 'done') {
          doneEmitted = true;
          onDone({ modelUsed: (parsed.data.model_used as string) ?? undefined });
        } else if (parsed.event === 'error') {
          // Terminal: stop reading so the clean-end fallback can't fire `onDone`
          // afterwards and let the widget persist the partial text as a real reply.
          onError((parsed.data.message as string) ?? 'The assistant stream errored.');
          await reader.cancel().catch(() => {});
          return;
        }
      }
    }
  } catch {
    // Aborted (user closed / navigated) or the stream dropped mid-flight.
    if (!signal?.aborted) onError('The assistant stream was interrupted.');
    return;
  }

  // A clean end without a `done` frame still resolves the turn.
  if (!doneEmitted) onDone({});
}

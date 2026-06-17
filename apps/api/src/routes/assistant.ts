import { Router } from 'express';
import { requireUser } from '@/lib/auth';
import { streamAssistantUpstream } from '@/lib/agent-client';

/** The upstream shape we need to pipe — satisfied by a fetch `Response`. */
export interface UpstreamStream {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
}

export interface AssistantStreamDeps {
  openUpstream: (payload: unknown) => Promise<UpstreamStream>;
}

/**
 * SSE passthrough for the application-assistant run (Phase 3 · Workstream M).
 *
 * Pipes the agent's `text/event-stream` straight through, unbuffered, so the browser
 * receives node-status events live. Mounted at the exact `/api/ai/assistant/stream` path
 * (before the AI router) so it doesn't double-apply the AI guards to run/resume.
 */
export function createAssistantStreamRouter(
  deps: AssistantStreamDeps = { openUpstream: streamAssistantUpstream },
) {
  const router = Router();

  router.post('/', async (request, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) return;

    const body = request.body as { description_text?: string; resume_text?: string; profile_text?: string };
    if (!body.description_text?.trim()) {
      response.status(400).json({ error: 'description_text is required' });
      return;
    }

    let upstream: UpstreamStream;
    try {
      upstream = await deps.openUpstream({
        description_text: body.description_text,
        resume_text: body.resume_text,
        profile_text: body.profile_text,
        user_id: userId,
      });
    } catch (error) {
      next(error);
      return;
    }

    if (!upstream.ok || !upstream.body) {
      response.status(upstream.status || 502).json({ error: 'Assistant stream unavailable' });
      return;
    }

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering

    const reader = upstream.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        response.write(Buffer.from(value));
      }
    } catch {
      // client disconnected or upstream errored mid-stream; just end the response
    } finally {
      response.end();
    }
  });

  return router;
}

export const assistantStreamRouter = createAssistantStreamRouter();

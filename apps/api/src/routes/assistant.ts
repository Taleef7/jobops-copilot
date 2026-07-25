import { Router } from 'express';
import { requireUser } from '@/lib/auth';
import { AgentDisabledError, streamAssistantUpstream } from '@/lib/agent-client';
import { getUserProfile } from '@/data/profile-store';

const AGENT_DISABLED_MESSAGE =
  'The AI agent service is not configured. Set AGENT_SERVICE_URL and a provider key to enable the assistant.';

/** The upstream shape we need to pipe — satisfied by a fetch `Response`. */
export interface UpstreamStream {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
}

export interface AssistantStreamDeps {
  openUpstream: (payload: unknown) => Promise<UpstreamStream>;
  /** Reads the caller's saved resume so the client needn't resend it. */
  loadProfile?: (userId: string) => Promise<{ resumeText?: string; profileText?: string } | undefined>;
}

/**
 * SSE passthrough for the application-assistant run (Phase 3 · Workstream M).
 *
 * Pipes the agent's `text/event-stream` straight through, unbuffered, so the browser
 * receives node-status events live. Mounted at the exact `/api/ai/assistant/stream` path
 * (before the AI router) so it doesn't double-apply the AI guards to run/resume.
 */
export function createAssistantStreamRouter(
  deps: AssistantStreamDeps = { openUpstream: streamAssistantUpstream, loadProfile: getUserProfile },
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

    // Fall back to the saved resume, the way /score-fit already does. Without
    // this the run scored a job description against nothing, failed the graph's
    // fit gate, and told the user "Your profile didn't score high enough for
    // this role" — blaming their profile for an input the client never sent.
    // The resume field on /assistant is labelled optional, so this was the
    // default path.
    const profile = await deps.loadProfile?.(userId).catch(() => undefined);
    const resumeText = body.resume_text?.trim() || profile?.resumeText;
    const profileText = body.profile_text?.trim() || profile?.profileText || resumeText;

    let upstream: UpstreamStream;
    try {
      upstream = await deps.openUpstream({
        description_text: body.description_text,
        resume_text: resumeText,
        profile_text: profileText,
        user_id: userId,
      });
    } catch (error) {
      // A disabled agent service (no AGENT_SERVICE_URL) is an expected
      // misconfiguration, not a server fault — surface it as 503, not a 500.
      if (error instanceof AgentDisabledError) {
        response.status(503).json({ error: AGENT_DISABLED_MESSAGE });
        return;
      }
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

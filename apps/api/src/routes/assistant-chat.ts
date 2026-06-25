import { Router } from 'express';
import { requireUser } from '@/lib/auth';
import { getJobById } from '@/data/job-store';
import { AgentDisabledError, streamAssistantChatUpstream } from '@/lib/agent-client';
import type { UpstreamStream } from '@/routes/assistant';

const AGENT_DISABLED_MESSAGE =
  'The AI agent service is not configured. Set AGENT_SERVICE_URL and a provider key to enable the assistant.';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantChatDeps {
  openUpstream: (payload: unknown) => Promise<UpstreamStream>;
  getJob: typeof getJobById;
}

const defaultDeps: AssistantChatDeps = {
  openUpstream: streamAssistantChatUpstream,
  getJob: getJobById,
};

/** Cap how much of the (untrusted) job description we feed as context. */
const DESCRIPTION_LIMIT = 1500;

/**
 * Build a compact, plain-text context block for the job the user is viewing.
 * Ownership is enforced by `getJob(userId, jobId)`; a miss returns no context.
 */
async function buildJobContext(
  getJob: AssistantChatDeps['getJob'],
  userId: string,
  jobId: string,
): Promise<string | undefined> {
  const job = await getJob(userId, jobId);
  if (!job) return undefined;

  const { analysis } = job;
  const lines = [
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location} (${job.workplaceType})`,
    job.fitScore != null ? `Fit score: ${job.fitScore}` : null,
    analysis?.fitSummary ? `Fit summary: ${analysis.fitSummary}` : null,
    analysis?.matchedSkills?.length ? `Matched skills: ${analysis.matchedSkills.join(', ')}` : null,
    analysis?.missingSkills?.length ? `Missing skills: ${analysis.missingSkills.join(', ')}` : null,
    job.descriptionText
      ? `Job description:\n${job.descriptionText.slice(0, DESCRIPTION_LIMIT)}`
      : null,
  ].filter(Boolean);

  return lines.join('\n');
}

function isValidMessages(value: unknown): value is ChatMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        (entry.role === 'user' || entry.role === 'assistant') &&
        typeof entry.content === 'string',
    )
  );
}

/**
 * SSE passthrough for the conversational assistant (Phase 5 · global widget).
 *
 * Builds the current job's context server-side (ownership-checked) and pipes the
 * agent's token `text/event-stream` straight through, unbuffered. Mounted at the
 * exact `/api/ai/assistant/chat` path (before the AI router) so the AI guards
 * aren't double-applied.
 */
export function createAssistantChatRouter(deps: AssistantChatDeps = defaultDeps) {
  const router = Router();

  router.post('/', async (request, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) return;

    const body = request.body as { messages?: unknown; jobId?: unknown };
    if (!isValidMessages(body.messages)) {
      response.status(400).json({ error: 'messages is required' });
      return;
    }

    // Context build must never break the chat — a failure just omits it.
    let context: string | undefined;
    if (typeof body.jobId === 'string' && body.jobId.trim()) {
      try {
        context = await buildJobContext(deps.getJob, userId, body.jobId.trim());
      } catch {
        context = undefined;
      }
    }

    let upstream: UpstreamStream;
    try {
      upstream = await deps.openUpstream({ messages: body.messages, context, user_id: userId });
    } catch (error) {
      // A disabled agent service (no AGENT_SERVICE_URL) is an expected
      // misconfiguration, not a server fault — surface it as 503 (which the
      // widget handles) rather than letting it become a generic 500.
      if (error instanceof AgentDisabledError) {
        response.status(503).json({ error: AGENT_DISABLED_MESSAGE });
        return;
      }
      next(error);
      return;
    }

    if (!upstream.ok || !upstream.body) {
      response.status(upstream.status || 502).json({ error: 'Assistant chat unavailable' });
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

export const assistantChatRouter = createAssistantChatRouter();

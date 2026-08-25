import { Router } from 'express';
import { isAgentId } from '@/data/agent-config-store';
import { requireUser } from '@/lib/auth';
import {
  AgentDisabledError,
  resumeAgentUpstream,
  streamAgentUpstream,
} from '@/lib/agent-client';
import type { UpstreamStream } from '@/routes/assistant';

const AGENT_DISABLED_MESSAGE =
  'The AI agent service is not configured. Set AGENT_SERVICE_URL and a provider key to enable the agents.';

export interface AgentsRouterDeps {
  openStream: (agentId: string, payload: unknown) => Promise<UpstreamStream>;
  openResume: (agentId: string, payload: unknown) => Promise<UpstreamStream>;
}

const defaultDeps: AgentsRouterDeps = {
  openStream: streamAgentUpstream,
  openResume: resumeAgentUpstream,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function pipeSse(upstream: UpstreamStream, response: import('express').Response) {
  if (!upstream.ok || !upstream.body) {
    response.status(upstream.status || 502).json({ error: 'Agent stream unavailable' });
    return;
  }

  response.status(200);
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');

  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      response.write(Buffer.from(value));
    }
  } catch {
    // Client disconnects and mid-stream upstream failures end the pipe quietly.
  } finally {
    response.end();
  }
}

function resolveAgent(agentId: string, response: import('express').Response): boolean {
  if (!isAgentId(agentId)) {
    response.status(404).json({ error: `Unknown agent: ${agentId}` });
    return false;
  }
  return true;
}

export function createAgentsRouter(deps: AgentsRouterDeps = defaultDeps) {
  const router = Router();

  router.post('/:agentId/stream', async (request, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) return;
    const agentId = request.params.agentId ?? '';
    if (!resolveAgent(agentId, response)) return;

    const body = (request.body ?? {}) as { jobId?: unknown; input?: unknown };
    if (body.jobId !== undefined && typeof body.jobId !== 'string') {
      response.status(400).json({ error: 'jobId must be a string' });
      return;
    }
    if (body.input !== undefined && !isObject(body.input)) {
      response.status(400).json({ error: 'input must be an object' });
      return;
    }

    try {
      const upstream = await deps.openStream(agentId, {
        user_id: userId,
        job_id: body.jobId,
        input: body.input ?? {},
      });
      await pipeSse(upstream, response);
    } catch (error) {
      if (error instanceof AgentDisabledError) {
        response.status(503).json({ error: AGENT_DISABLED_MESSAGE });
        return;
      }
      next(error);
    }
  });

  router.post('/:agentId/resume', async (request, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) return;
    const agentId = request.params.agentId ?? '';
    if (!resolveAgent(agentId, response)) return;

    const body = (request.body ?? {}) as { threadId?: unknown; payload?: unknown };
    if (typeof body.threadId !== 'string' || !body.threadId.trim()) {
      response.status(400).json({ error: 'threadId is required' });
      return;
    }
    if (body.payload !== undefined && !isObject(body.payload)) {
      response.status(400).json({ error: 'payload must be an object' });
      return;
    }
    const prefix = `${userId}:${agentId}`;
    if (body.threadId !== prefix && !body.threadId.startsWith(`${prefix}:`)) {
      response.status(403).json({ error: 'Thread does not belong to this user and agent' });
      return;
    }

    try {
      const upstream = await deps.openResume(agentId, {
        thread_id: body.threadId,
        payload: body.payload ?? {},
      });
      await pipeSse(upstream, response);
    } catch (error) {
      if (error instanceof AgentDisabledError) {
        response.status(503).json({ error: AGENT_DISABLED_MESSAGE });
        return;
      }
      next(error);
    }
  });

  return router;
}

export const agentsRouter = createAgentsRouter();

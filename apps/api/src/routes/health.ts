import { Router } from 'express';
import { getStoreMode } from '@/data/job-store';
import { isAgentEnabled } from '@/lib/agent-client';
import { pingDatabase } from '@/lib/postgres';

export const healthRouter = Router();

type Readiness = {
  statusCode: number;
  body: { status: string; mode: string; db: string };
};

// Pure decision logic for the readiness probe, kept separate so it is unit-testable
// without a live database.
export function computeReadiness(mode: 'postgres' | 'file', dbReachable: boolean): Readiness {
  if (mode !== 'postgres') {
    return { statusCode: 200, body: { status: 'ready', mode, db: 'skipped' } };
  }

  return dbReachable
    ? { statusCode: 200, body: { status: 'ready', mode, db: 'ok' } }
    : { statusCode: 503, body: { status: 'not_ready', mode, db: 'error' } };
}

healthRouter.get('/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'jobops-copilot-api',
    mode: getStoreMode(),
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe: unlike /health (liveness), this proves the data path actually
// works by running a real query, so a deploy with an unreachable DB fails its gate.
healthRouter.get('/health/ready', async (_request, response) => {
  const mode = getStoreMode();
  const dbReachable = mode === 'postgres' ? await pingDatabase() : false;
  const { statusCode, body } = computeReadiness(mode, dbReachable);
  response.status(statusCode).json(body);
});

// Richer status for the Settings page: real provider/model + integration config,
// so the UI reflects the truth instead of hardcoded values.
healthRouter.get('/status', async (_request, response, next) => {
  try {
    const agentUrl = process.env.AGENT_SERVICE_URL?.trim().replace(/\/$/, '');
    let agent: Record<string, unknown> = { enabled: isAgentEnabled(), reachable: false };

    if (agentUrl) {
      try {
        const res = await fetch(`${agentUrl}/health`, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const agentHealth = (await res.json()) as Record<string, unknown>;
          agent = { ...agentHealth, enabled: true, reachable: true };
        }
      } catch {
        // Agent asleep/unreachable — report enabled but not reachable.
      }
    }

    response.json({
      storeMode: getStoreMode(),
      agent,
      integrations: {
        gmailDrafts: process.env.GMAIL_DRAFTS_ENABLED === 'true',
        n8nWebhook: Boolean(process.env.N8N_WEBHOOK_SECRET?.trim()),
        tavily: Boolean((agent as { tavily_configured?: boolean }).tavily_configured),
      },
    });
  } catch (error) {
    next(error);
  }
});

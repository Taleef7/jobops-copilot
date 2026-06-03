import { Router } from 'express';
import { getStoreMode } from '@/data/job-store';
import { isAgentEnabled } from '@/lib/agent-client';

export const healthRouter = Router();

healthRouter.get('/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'jobops-copilot-api',
    mode: getStoreMode(),
    timestamp: new Date().toISOString(),
  });
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

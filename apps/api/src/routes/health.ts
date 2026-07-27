import { Router } from 'express';
import { getStoreMode } from '@/data/job-store';
import { isAgentEnabled } from '@/lib/agent-client';
import { getMigrationStatus, type MigrationStatus } from '@/lib/migrate-on-boot';
import { pingDatabase } from '@/lib/postgres';

export const healthRouter = Router();

type Readiness = {
  statusCode: number;
  body: { status: string; mode: string; db: string; migrations: string; pending?: string[] };
};

// Pure decision logic for the readiness probe, kept separate so it is unit-testable
// without a live database.
export function computeReadiness(
  mode: 'postgres' | 'file',
  dbReachable: boolean,
  migrations: MigrationStatus,
): Readiness {
  if (mode !== 'postgres') {
    return {
      statusCode: 200,
      body: { status: 'ready', mode, db: 'skipped', migrations: 'skipped' },
    };
  }

  if (!dbReachable) {
    return {
      statusCode: 503,
      body: { status: 'not_ready', mode, db: 'error', migrations: 'unknown' },
    };
  }

  // A reachable database running behind its migrations is NOT ready. Reads
  // against a missing table return empty rather than failing, so the only way
  // this surfaces is if the probe refuses to go green.
  if (migrations.state === 'pending') {
    return {
      statusCode: 503,
      body: {
        status: 'not_ready',
        mode,
        db: 'ok',
        migrations: 'pending',
        pending: migrations.pending,
      },
    };
  }

  // 'unknown' (schema_migrations unreadable) stays 200: connectivity is proven,
  // and flapping the probe would have App Service restart a working API. The
  // deploy gate asserts migrations == "ok", so an unknown still blocks a ship.
  return {
    statusCode: 200,
    body: { status: 'ready', mode, db: 'ok', migrations: migrations.state },
  };
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
  const migrations: MigrationStatus = dbReachable
    ? await getMigrationStatus()
    : { state: 'unknown', reason: 'database unreachable' };
  const { statusCode, body } = computeReadiness(mode, dbReachable, migrations);
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

import { Router } from 'express';
import { getStoreMode } from '@/data/job-store';
import { agentHeaders, isAgentEnabled } from '@/lib/agent-client';
import { requireUser } from '@/lib/auth';
import { getLlmCanaryResult } from '@/lib/llm-canary';
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

// What the agent runs, from its key-protected /health/details, kept for a minute so the
// status page can't be used to keep a scale-to-zero agent awake (#348).
const AGENT_DETAILS_TTL_MS = 60_000;
let agentDetails: { at: number; value: Record<string, unknown> } | null = null;

async function readAgentDetails(): Promise<Record<string, unknown>> {
  if (agentDetails && Date.now() - agentDetails.at < AGENT_DETAILS_TTL_MS) return agentDetails.value;
  const agentUrl = process.env.AGENT_SERVICE_URL?.trim().replace(/\/$/, '');
  let value: Record<string, unknown> = { enabled: isAgentEnabled(), reachable: false };
  if (agentUrl) {
    try {
      const res = await fetch(`${agentUrl}/health/details`, {
        headers: agentHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) value = { ...((await res.json()) as Record<string, unknown>), enabled: true, reachable: true };
    } catch {
      // Agent asleep or unreachable: enabled but not reachable.
    }
  }
  agentDetails = { at: Date.now(), value };
  return value;
}

/** Test seam. */
export function resetStatusCacheForTests(): void {
  agentDetails = null;
}

// Status for the Settings page: the real provider and model, the integrations, and the
// last LLM canary result. Signed-in only (#348), and it never calls the model.
healthRouter.get('/status', async (request, response, next) => {
  try {
    if (!requireUser(request, response)) return;
    const agent = await readAgentDetails();

    response.json({
      storeMode: getStoreMode(),
      agent,
      llmCanary: await getLlmCanaryResult(),
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

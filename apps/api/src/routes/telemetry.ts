import { Router } from 'express';
import { listJobs } from '@/data/job-store';
import {
  AgentDisabledError,
  analyzeTelemetryViaAgent,
  fetchEvDemoViaAgent,
  isAgentEnabled,
} from '@/lib/agent-client';
import { requireUser } from '@/lib/auth';
import { reserveAiBudget } from '@/lib/budget';
import { buildActivitySeries, localTelemetryFallback } from '@/lib/telemetry';

export interface TelemetryDeps {
  listJobs: typeof listJobs;
  analyzeTelemetryViaAgent: typeof analyzeTelemetryViaAgent;
  fetchEvDemoViaAgent: typeof fetchEvDemoViaAgent;
  isAgentEnabled: typeof isAgentEnabled;
  reserveAiBudget: typeof reserveAiBudget;
}

const productionDeps: TelemetryDeps = {
  listJobs,
  analyzeTelemetryViaAgent,
  fetchEvDemoViaAgent,
  isAgentEnabled,
  reserveAiBudget,
};

export function createTelemetryRouter(deps: TelemetryDeps = productionDeps) {
  const telemetryRouter = Router();

/**
 * Pipeline telemetry insights. Builds a daily activity series from the CRM and
 * analyzes it via the agent (pandas trend/anomaly/forecast + LLM narration),
 * falling back to a deterministic local summary when the agent is unavailable.
 */
telemetryRouter.get('/insights', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const series = buildActivitySeries(await deps.listJobs(userId));

    if (deps.isAgentEnabled()) {
      if (!(await deps.reserveAiBudget(userId, 'telemetry'))) {
        return response.status(429).json({ error: 'Daily AI budget reached' });
      }
      try {
        return response.json(await deps.analyzeTelemetryViaAgent(series));
      } catch (error) {
        console.warn('telemetry agent failed; using local fallback', error);
      }
    }

    return response.json(localTelemetryFallback(series));
  } catch (error) {
    next(error);
  }
});

/**
 * Synthetic EV battery telemetry demo — the same anomaly/trend/forecast
 * analysis applied to vehicle sensor data, to show the pattern transfers.
 */
telemetryRouter.get('/ev-demo', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    if (!deps.isAgentEnabled()) {
      return response.status(503).json({
        error: 'The EV telemetry demo requires the agent service. Set AGENT_SERVICE_URL.',
      });
    }
    if (!(await deps.reserveAiBudget(userId, 'telemetry'))) {
      return response.status(429).json({ error: 'Daily AI budget reached' });
    }

    return response.json(await deps.fetchEvDemoViaAgent());
  } catch (error) {
    if (error instanceof AgentDisabledError) {
      return response.status(503).json({
        error: 'The EV telemetry demo requires the agent service. Set AGENT_SERVICE_URL.',
      });
    }
    next(error);
  }
  });

  return telemetryRouter;
}

export const telemetryRouter = createTelemetryRouter();

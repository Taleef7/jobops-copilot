import { Router } from 'express';
import { listJobs } from '@/data/job-store';
import {
  AgentDisabledError,
  analyzeTelemetryViaAgent,
  fetchEvDemoViaAgent,
  isAgentEnabled,
} from '@/lib/agent-client';
import { buildActivitySeries, localTelemetryFallback } from '@/lib/telemetry';

export const telemetryRouter = Router();

/**
 * Pipeline telemetry insights. Builds a daily activity series from the CRM and
 * analyzes it via the agent (pandas trend/anomaly/forecast + LLM narration),
 * falling back to a deterministic local summary when the agent is unavailable.
 */
telemetryRouter.get('/insights', async (_request, response, next) => {
  try {
    const series = buildActivitySeries(await listJobs());

    if (isAgentEnabled()) {
      try {
        return response.json(await analyzeTelemetryViaAgent(series));
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
telemetryRouter.get('/ev-demo', async (_request, response, next) => {
  try {
    return response.json(await fetchEvDemoViaAgent());
  } catch (error) {
    if (error instanceof AgentDisabledError) {
      return response.status(503).json({
        error: 'The EV telemetry demo requires the agent service. Set AGENT_SERVICE_URL.',
      });
    }
    next(error);
  }
});

import { Router } from 'express';
import { requireN8nWebhookSecret } from '@/lib/n8n';
import { runDiscoverySweep, defaultDeps as defaultDiscoveryDeps, type DiscoveryRouterDeps } from '@/routes/discovery';
import { runLivenessSweep, type LivenessDeps } from '@/lib/liveness';
import { fetchJobPage } from '@/lib/job-url-fetch';

export interface InternalRouterDeps {
  discovery: DiscoveryRouterDeps;
  liveness: LivenessDeps;
}

const defaultInternalDeps: InternalRouterDeps = {
  discovery: defaultDiscoveryDeps,
  liveness: {
    fetchPage: fetchJobPage,
  },
};

export function createInternalRouter(deps: InternalRouterDeps = defaultInternalDeps) {
  const router = Router();
  router.use(requireN8nWebhookSecret);

  router.post('/discovery/run', async (_request, response, next) => {
    try {
      response.json(await runDiscoverySweep(deps.discovery));
    } catch (error) {
      next(error);
    }
  });

  router.post('/liveness/run', async (_request, response, next) => {
    try {
      response.json(await runLivenessSweep(deps.liveness));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const internalRouter = createInternalRouter();

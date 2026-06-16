import { Router } from 'express';
import { requireUser } from '@/lib/auth';
import { createJob, listJobs } from '@/data/job-store';
import { listSavedSearches, listUsersWithSavedSearches } from '@/data/saved-search-store';
import { getJobSource } from '@/lib/job-sources';
import { requireN8nWebhookSecret } from '@/lib/n8n';
import { runDiscoveryForUser, type DiscoveryResult } from '@/lib/discovery';

export interface DiscoveryRouterDeps {
  runDiscovery: (userId: string) => Promise<DiscoveryResult>;
  listUsersWithSavedSearches: typeof listUsersWithSavedSearches;
}

const defaultDeps: DiscoveryRouterDeps = {
  runDiscovery: (userId) =>
    runDiscoveryForUser(userId, { source: getJobSource(), listJobs, createJob, listSavedSearches }),
  listUsersWithSavedSearches,
};

/** User-facing discovery: `POST /api/discovery/run`. */
export function createDiscoveryRouter(deps: DiscoveryRouterDeps = defaultDeps) {
  const router = Router();

  router.post('/run', async (request, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) return;
    try {
      response.json(await deps.runDiscovery(userId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * Service-to-service scheduled sweep: `POST /api/n8n/discover`. Mounted under
 * `/api/n8n` so it inherits the shared-API-key exemption; guarded by the n8n
 * webhook secret. Iterates every user with saved searches.
 */
export function createDiscoverySweepRouter(deps: DiscoveryRouterDeps = defaultDeps) {
  const router = Router();
  router.use(requireN8nWebhookSecret);

  router.post('/', async (_request, response, next) => {
    try {
      const userIds = await deps.listUsersWithSavedSearches();
      let inserted = 0;
      let skipped = 0;
      const perUser: Array<{ user_id: string } & DiscoveryResult> = [];

      for (const userId of userIds) {
        const result = await deps.runDiscovery(userId);
        inserted += result.inserted;
        skipped += result.skipped;
        perUser.push({ user_id: userId, ...result });
      }

      response.json({
        workflow: 'discover',
        users: userIds.length,
        inserted,
        skipped,
        per_user: perUser,
        notification: `Discovery swept ${userIds.length} saved-search user(s): ${inserted} new, ${skipped} skipped.`,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const discoveryRouter = createDiscoveryRouter();
export const discoverySweepRouter = createDiscoverySweepRouter();

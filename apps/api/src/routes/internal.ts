import { Router } from 'express';
import { requireN8nWebhookSecret } from '@/lib/n8n';
import { runDiscoverySweep, defaultDeps as defaultDiscoveryDeps, type DiscoveryRouterDeps } from '@/routes/discovery';
import { runLivenessSweep, type LivenessDeps } from '@/lib/liveness';
import { fetchJobPage } from '@/lib/job-url-fetch';
import { generateDailyDigest } from '@/lib/notify/digest';
import { listUsersForDigest } from '@/data/notification-store';
import { runLlmCanary, saveLlmCanaryResult, type LlmCanaryResult } from '@/lib/llm-canary';
import type { NotificationRecord, NotificationSettings } from '@/types';

export interface DigestDeps {
  generateDailyDigest: (userId: string, now?: Date) => Promise<NotificationRecord>;
  listUsersForDigest: (targetHour?: number) => Promise<Array<{ userId: string; settings: NotificationSettings }>>;
}

export interface LlmCanaryDeps {
  run: () => Promise<LlmCanaryResult>;
  save: (result: LlmCanaryResult) => Promise<void>;
}

export interface InternalRouterDeps {
  discovery: DiscoveryRouterDeps;
  liveness: LivenessDeps;
  digest: DigestDeps;
  llmCanary: LlmCanaryDeps;
}

const defaultInternalDeps: InternalRouterDeps = {
  discovery: defaultDiscoveryDeps,
  liveness: {
    fetchPage: fetchJobPage,
  },
  digest: {
    generateDailyDigest,
    listUsersForDigest,
  },
  llmCanary: { run: runLlmCanary, save: saveLlmCanaryResult },
};

export function createInternalRouter(deps: Partial<InternalRouterDeps> = {}) {
  const resolvedDeps: InternalRouterDeps = {
    discovery: deps.discovery ?? defaultInternalDeps.discovery,
    liveness: deps.liveness ?? defaultInternalDeps.liveness,
    digest: deps.digest ?? defaultInternalDeps.digest,
    llmCanary: deps.llmCanary ?? defaultInternalDeps.llmCanary,
  };

  const router = Router();
  router.use(requireN8nWebhookSecret);

  router.post('/discovery/run', async (_request, response, next) => {
    try {
      response.json(await runDiscoverySweep(resolvedDeps.discovery));
    } catch (error) {
      next(error);
    }
  });

  // The LLM canary (#348): one tiny real model call through the agent, run by the daily
  // workflow and after deploys. 503 when the model fails, so a scheduled run goes red.
  router.post('/llm-canary', async (_request, response, next) => {
    try {
      const result = await resolvedDeps.llmCanary.run();
      await resolvedDeps.llmCanary.save(result);
      response.status(result.ok ? 200 : 503).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/liveness/run', async (_request, response, next) => {
    try {
      response.json(await runLivenessSweep(resolvedDeps.liveness));
    } catch (error) {
      next(error);
    }
  });

  router.post('/digest/run', async (request, response, next) => {
    try {
      const force = request.query.force === 'true' || Boolean(request.body?.force);
      const queryHour = request.query.hour !== undefined ? parseInt(String(request.query.hour), 10) : undefined;
      const bodyHour = request.body?.hour !== undefined ? parseInt(String(request.body.hour), 10) : undefined;
      const targetHour = queryHour ?? bodyHour;
      const specificUserId = (request.query.userId as string) || (request.body?.userId as string) || undefined;

      if (specificUserId) {
        const notif = await resolvedDeps.digest.generateDailyDigest(specificUserId);
        response.json({
          workflow: 'digest',
          processed: 1,
          dispatched: 1,
          skipped: 0,
          results: [{ userId: specificUserId, notificationId: notif.id, status: 'dispatched' }],
        });
        return;
      }

      const effectiveHour = force ? undefined : (targetHour ?? new Date().getHours());
      const eligibleUsers = await resolvedDeps.digest.listUsersForDigest(effectiveHour);

      const results: Array<{ userId: string; notificationId?: string; status: 'dispatched' | 'failed'; error?: string }> = [];
      let dispatched = 0;
      let failed = 0;

      for (const user of eligibleUsers) {
        try {
          const notif = await resolvedDeps.digest.generateDailyDigest(user.userId);
          dispatched += 1;
          results.push({ userId: user.userId, notificationId: notif.id, status: 'dispatched' });
        } catch (err: unknown) {
          failed += 1;
          const message = err instanceof Error ? err.message : 'Digest generation failed';
          results.push({ userId: user.userId, status: 'failed', error: message });
        }
      }

      response.json({
        workflow: 'digest',
        processed: eligibleUsers.length,
        dispatched,
        skipped: failed,
        results,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const internalRouter = createInternalRouter();

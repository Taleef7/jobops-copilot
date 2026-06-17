import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { attachUserId, clerkAuth } from '@/lib/auth';
import { globalLimiter, strictLimiter } from '@/lib/rate-limit';
import { enforceDailyBudget } from '@/lib/budget';
import { aiRouter } from '@/routes/ai';
import { assistantStreamRouter } from '@/routes/assistant';
import { demoRouter } from '@/routes/demo';
import { healthRouter } from '@/routes/health';
import { jobsRouter } from '@/routes/jobs';
import { n8nRouter } from '@/routes/n8n';
import { profileRouter } from '@/routes/profile';
import { reportsRouter } from '@/routes/reports';
import { outreachRouter } from '@/routes/outreach';
import { telemetryRouter } from '@/routes/telemetry';
import { discoveryRouter, discoverySweepRouter } from '@/routes/discovery';
import { savedSearchesRouter } from '@/routes/saved-searches';

const mutatingMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function requireSharedApiKey(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction,
) {
  const sharedSecret = process.env.API_SHARED_SECRET?.trim();
  const n8nWebhookSecret = process.env.N8N_WEBHOOK_SECRET?.trim();

  if (
    !sharedSecret ||
    !mutatingMethods.has(request.method) ||
    (request.path.startsWith('/api/n8n') && Boolean(n8nWebhookSecret))
  ) {
    next();
    return;
  }

  const providedKey = request.header('X-API-Key')?.trim();

  if (providedKey !== sharedSecret) {
    response.status(401).json({ error: 'Missing or invalid API key' });
    return;
  }

  next();
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // One proxy hop in front of the app (Azure App Service) — needed so `req.ip` is
  // the real client, which the rate limiter keys on for unauthenticated requests.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: true,
      allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'X-N8N-Webhook-Secret'],
    }),
  );
  app.use(requireSharedApiKey);
  app.use(express.json({ limit: '5mb' }));
  app.use(clerkAuth);
  app.use(attachUserId);
  // Lenient global limit (keyed by user, else IP). Runs after `attachUserId` so the
  // user-scoped key is available; the strict limit on AI/discovery is mounted below.
  app.use(globalLimiter);

  app.use('/api', healthRouter);
  app.use('/api/jobs', jobsRouter);
  // SSE assistant stream: mounted at the exact path (before the AI router) so it pipes
  // unbuffered and doesn't double-apply the AI guards to /assistant/run|resume.
  app.use('/api/ai/assistant/stream', strictLimiter, enforceDailyBudget, assistantStreamRouter);
  // Stricter per-user limit on the expensive AI + discovery routes; the AI routes
  // additionally enforce the per-user daily spend ceiling (discovery has no LLM cost).
  app.use('/api/ai', strictLimiter, enforceDailyBudget, aiRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/demo', demoRouter);
  app.use('/api/outreach', outreachRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/telemetry', telemetryRouter);
  app.use('/api/discovery', strictLimiter, discoveryRouter);
  app.use('/api/saved-searches', savedSearchesRouter);
  // Mounted before '/api/n8n' so this more specific path wins; it inherits the
  // shared-API-key exemption (path starts with /api/n8n) and uses the n8n secret.
  app.use('/api/n8n/discover', discoverySweepRouter);
  app.use('/api/n8n', n8nRouter);

  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    console.error(error);
    response.status(500).json({
      error: 'Internal server error',
    });
    void next;
  });

  return app;
}

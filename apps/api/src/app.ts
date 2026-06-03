import cors from 'cors';
import express from 'express';
import { aiRouter } from '@/routes/ai';
import { healthRouter } from '@/routes/health';
import { jobsRouter } from '@/routes/jobs';
import { n8nRouter } from '@/routes/n8n';
import { reportsRouter } from '@/routes/reports';
import { outreachRouter } from '@/routes/outreach';
import { telemetryRouter } from '@/routes/telemetry';

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
  app.use(
    cors({
      origin: true,
      allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'X-N8N-Webhook-Secret'],
    }),
  );
  app.use(requireSharedApiKey);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', healthRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/outreach', outreachRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/telemetry', telemetryRouter);
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

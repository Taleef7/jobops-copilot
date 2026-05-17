import cors from 'cors';
import express from 'express';
import { aiRouter } from '@/routes/ai';
import { healthRouter } from '@/routes/health';
import { jobsRouter } from '@/routes/jobs';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', healthRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/ai', aiRouter);

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

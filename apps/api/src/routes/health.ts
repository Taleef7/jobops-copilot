import { Router } from 'express';
import { getStoreMode } from '@/data/job-store';

export const healthRouter = Router();

healthRouter.get('/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'jobops-copilot-api',
    mode: getStoreMode(),
    timestamp: new Date().toISOString(),
  });
});

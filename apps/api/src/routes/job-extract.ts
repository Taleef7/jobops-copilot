import { Router } from 'express';
import { requireUser } from '@/lib/auth';
import { extractJobFromUrl, type ExtractResult } from '@/lib/job-url-fetch';

export interface JobExtractDeps {
  extract: (url: string) => Promise<ExtractResult>;
}

const defaultDeps: JobExtractDeps = { extract: (url) => extractJobFromUrl(url) };

/** `POST /api/jobs/extract` — fetch a job URL and return autofill fields. */
export function createJobExtractRouter(deps: JobExtractDeps = defaultDeps) {
  const router = Router();

  router.post('/extract', async (request, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) return;

    const url = typeof request.body?.url === 'string' ? request.body.url.trim() : '';
    if (!url) {
      response.status(400).json({ error: 'A job URL is required.' });
      return;
    }

    try {
      const result = await deps.extract(url);
      if (!result.ok) {
        response.status(400).json({ error: result.error });
        return;
      }
      response.json(result.data);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const jobExtractRouter = createJobExtractRouter();

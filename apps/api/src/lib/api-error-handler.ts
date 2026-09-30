import type { NextFunction, Request, Response } from 'express';
import { AiBudgetExceededError } from '@/lib/ai-call-context';
import { AiUnavailableError } from '@/lib/agent-client';

/**
 * The API's last error handler, shared so a test that mounts one router answers the same
 * way the app does.
 *
 * - The daily AI budget is spent: 429.
 * - The AI couldn't answer (#349): 503 with the reason and `retryable: true`. Nothing was
 *   saved: there is no fallback that makes up a result.
 * - Anything else: 500.
 */
export function apiErrorHandler(error: unknown, _request: Request, response: Response, next: NextFunction): void {
  if (error instanceof AiBudgetExceededError) {
    response.status(429).json({ error: 'Daily AI budget reached' });
    return;
  }
  if (error instanceof AiUnavailableError) {
    response.status(503).json({ error: error.message, retryable: true });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'Internal server error' });
  void next;
}

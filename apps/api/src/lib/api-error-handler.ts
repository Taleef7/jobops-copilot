import type { NextFunction, Request, Response } from 'express';
import { AiBudgetExceededError } from '@/lib/ai-call-context';
import { AiRefusedInputError, AiUnavailableError } from '@/lib/agent-client';
import { ResumeTooLargeError } from '@/lib/input-caps';

/**
 * The API's last error handler, shared so a test that mounts one router answers the same
 * way the app does.
 *
 * - The daily AI budget is spent: 429.
 * - The agent refused the input as instructions to the AI (#355): 422 with the reason.
 * - The AI couldn't answer (#349): 503 with the reason and `retryable: true`. Nothing was
 *   saved: there is no fallback that makes up a result.
 * - A résumé too big to draw (#352): 413.
 * - Anything else: 500.
 */
export function apiErrorHandler(error: unknown, _request: Request, response: Response, next: NextFunction): void {
  if (error instanceof AiBudgetExceededError) {
    response.status(429).json({ error: 'Daily AI budget reached' });
    return;
  }
  if (error instanceof AiRefusedInputError) {
    response.status(422).json({ error: error.message });
    return;
  }
  if (error instanceof AiUnavailableError) {
    response.status(503).json({ error: error.message, retryable: true });
    return;
  }
  if (error instanceof ResumeTooLargeError) {
    response.status(413).json({ error: error.message });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'Internal server error' });
  void next;
}

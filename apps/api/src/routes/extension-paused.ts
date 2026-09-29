import type { Request, Response } from 'express';

/**
 * The JobOps Chrome extension is paused (#342). Its API answered with invented
 * work-authorization values and could fill another job's answers, so every
 * `/api/ext` and `/api/ext-tokens` request now gets a 410, whatever token or key
 * it carries. The code is kept under `extensions/chrome`; the API side can be
 * restored from the tag `extension-paused-2026-09-28`. Saved answers stay in
 * `application_answers` and are served by `/api/answers`.
 */
export function extensionPaused(_request: Request, response: Response) {
  response.status(410).json({
    code: 'EXTENSION_PAUSED',
    error: 'The JobOps Chrome extension is paused. Remove it from Chrome; your saved answers are kept.',
  });
}

/**
 * Per-request user identity.
 *
 * In production the web app forwards the Clerk session token as a Bearer header;
 * `clerkMiddleware()` verifies it and `getAuth(req).userId` yields the Clerk user
 * id. Locally and in tests (no `CLERK_SECRET_KEY`), we fall back to a dev user id
 * (overridable per request via `X-User-Id`) so the API stays runnable offline.
 *
 * n8n webhook calls are machine-to-machine; they own data under a configurable
 * system user (`N8N_USER_ID`).
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { clerkMiddleware, getAuth } from '@clerk/express';
import { safeEqual } from '@/lib/safe-equal';

const DEV_USER_ID = process.env.DEV_USER_ID?.trim() || 'user_local_dev';

/** The user that machine-to-machine n8n webhook data is owned by. */
export const N8N_USER_ID = process.env.N8N_USER_ID?.trim() || DEV_USER_ID;

export const clerkEnabled = Boolean(process.env.CLERK_SECRET_KEY?.trim());

/** Populates Clerk auth state on the request (no-op when Clerk is unconfigured). */
export const clerkAuth: RequestHandler = clerkEnabled
  ? clerkMiddleware()
  : (_request, _response, next) => next();

/** Resolves `req.userId` from Clerk (or the dev/n8n fallback). */
export function attachUserId(request: Request, _response: Response, next: NextFunction) {
  if (request.path.startsWith('/api/n8n')) {
    request.userId = N8N_USER_ID;
    return next();
  }

  // Service principal (e.g. the MCP server bridge): a holder of the shared API key may act
  // on behalf of a specific user via X-User-Id. Mirrors the n8n machine-to-machine trust —
  // only a caller with the server-side secret can set the user, so unauthenticated clients
  // can't (the X-User-Id below it is honored only in dev where Clerk is off).
  const sharedSecret = process.env.API_SHARED_SECRET?.trim();
  const onBehalfOf = request.header('X-User-Id')?.trim();
  if (sharedSecret && safeEqual(request.header('X-API-Key')?.trim(), sharedSecret) && onBehalfOf) {
    request.userId = onBehalfOf;
    return next();
  }

  if (clerkEnabled) {
    const { userId } = getAuth(request);
    if (userId) {
      request.userId = userId;
    }
  } else {
    request.userId = request.header('X-User-Id')?.trim() || DEV_USER_ID;
  }

  next();
}

/** Returns the request user id, or sends 401 and returns null when absent. */
export function requireUser(request: Request, response: Response): string | null {
  const userId = request.userId;
  if (!userId) {
    response.status(401).json({ error: 'Authentication required' });
    return null;
  }
  return userId;
}

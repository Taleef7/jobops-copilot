/**
 * CORS origin allowlist (QA·F).
 *
 * `cors({ origin: true })` reflects whatever `Origin` the caller sends, which
 * defeats the browser's cross-origin protection. Instead we allow only an
 * explicit allowlist: `CORS_ALLOWED_ORIGINS` (comma-separated) in production,
 * falling back to the local web dev origins so the app stays runnable offline.
 * Requests with no `Origin` (curl, same-origin, server-to-server) are allowed —
 * CORS is a browser concern; non-browser auth is enforced separately.
 */

import type { CorsOptions } from 'cors';

const DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

const ALLOWED_HEADERS = ['Content-Type', 'X-API-Key', 'Authorization', 'X-N8N-Webhook-Secret'];

export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.CORS_ALLOWED_ORIGINS?.trim();
  if (!configured) return DEV_ORIGINS;
  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function corsOptions(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  const allowlist = allowedOrigins(env);
  return {
    origin(origin, callback) {
      // No Origin header → not a browser cross-origin request; allow.
      if (!origin || allowlist.includes(origin)) {
        callback(null, true);
        return;
      }
      // Deny without throwing: omit the ACAO headers so the browser blocks it,
      // rather than surfacing a 500 from the error handler.
      callback(null, false);
    },
    allowedHeaders: ALLOWED_HEADERS,
  };
}

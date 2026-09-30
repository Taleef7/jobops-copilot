/**
 * The Express routes the browser may reach through `/api/proxy` (#347). Everything else,
 * including `/internal/*`, `/api/n8n/*` and `/api/ext*`, gets 404 without an upstream
 * call. Issues that add or remove client calls edit this list; `allowed-paths.test.ts`
 * checks that every path the client calls is on it.
 */
export const PROXY_ALLOWED_PREFIXES = [
  '/api/ai',
  '/api/answers',
  '/api/contacts',
  // Clear my data. Load sample data goes with D3 (#366).
  '/api/demo/clear',
  '/api/demo/seed',
  '/api/discovery',
  '/api/feed',
  '/api/jobs',
  '/api/notification-settings',
  '/api/notifications',
  '/api/outreach',
  '/api/profile',
  '/api/push',
  '/api/reports',
  '/api/resume-versions',
  '/api/saved-searches',
  '/api/status',
  '/api/target-companies',
  '/api/telemetry',
] as const;

/** Whether the proxy forwards this path (as Next's catch-all segments). */
export function isProxyPathAllowed(segments: string[]): boolean {
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..' || /[\\/]/.test(segment))) {
    return false;
  }
  const path = `/${segments.join('/')}`;
  return PROXY_ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

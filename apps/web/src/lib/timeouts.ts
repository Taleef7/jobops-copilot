/**
 * How long each layer waits (#349). Each waits longer than the one behind it, so the API's
 * own answer (a 503 with the reason) reaches the page, and the browser's timeout fires last.
 */

/** The API's own limit on an agent call (AGENT_TASK_TIMEOUT_MS in apps/api agent-client.ts). */
export const API_AGENT_LIMIT_MS = 120_000;

/** A plain API call from the web. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** A call that waits on the AI: just past the API's limit. */
export const AI_REQUEST_TIMEOUT_MS = 130_000;

/**
 * The same-origin proxy's wait for the API's response headers. At least the client's AI
 * timeout, so a slow AI call ends with the client's message and not a proxy 504.
 */
export const PROXY_UPSTREAM_TIMEOUT_MS = 135_000;

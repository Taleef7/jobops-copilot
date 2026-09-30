import { expect, it } from 'vitest';
import { AI_REQUEST_TIMEOUT_MS, API_AGENT_LIMIT_MS, PROXY_UPSTREAM_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from './timeouts';

// #349: each layer waits longer than the one behind it, so the API's own answer (a 503 with
// the reason) always reaches the page, and the browser's timeout is the one that fires.
it('orders the timeouts: API agent limit < client AI timeout <= proxy', () => {
  expect(REQUEST_TIMEOUT_MS).toBe(30_000);
  expect(AI_REQUEST_TIMEOUT_MS).toBeGreaterThan(API_AGENT_LIMIT_MS);
  expect(PROXY_UPSTREAM_TIMEOUT_MS).toBeGreaterThanOrEqual(AI_REQUEST_TIMEOUT_MS);
});

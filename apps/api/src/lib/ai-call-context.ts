/**
 * Per-request record of whether a request actually reached the AI agent, and how much
 * input it sent (#345). The budget guard reserves up front, then refunds a request that
 * never reached the agent (a 400, a 404, a disabled agent) and tops up one whose input
 * cost more than the flat reservation. The agent client notes every call it sends.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface AiCallContext {
  reachedAgent: boolean;
  inputChars: number;
}

const storage = new AsyncLocalStorage<AiCallContext>();

export function runWithAiCallContext<T>(context: AiCallContext, run: () => T): T {
  return storage.run(context, run);
}

/** Called by the agent client right before it sends a paid request. */
export function noteAgentCall(inputChars: number): void {
  const context = storage.getStore();
  if (!context) return;
  context.reachedAgent = true;
  context.inputChars += inputChars;
}

/**
 * Per-request budget state for calls to the AI agent (#345). The budget guard reserves a
 * flat estimate up front; before each paid call the agent client reserves whatever the
 * input's size costs on top, atomically against the daily ceiling, and the call is refused
 * if it doesn't fit. A request that never reached the agent is refunded by the guard.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { estimateCostFromChars } from '@/lib/cost';

export interface AiCallContext {
  reachedAgent: boolean;
  inputChars: number;
  /** What this request has reserved so far. */
  reservedUsd: number;
  /** Atomically reserve more against the ceiling (counts as no new call); false when it doesn't fit. */
  reserveMore?: (usd: number) => Promise<boolean>;
  /** Some input was cut to the LLM limit (lib/input-caps.ts). */
  inputTruncated?: boolean;
}

/** The daily AI budget can't cover this call. The app answers 429. */
export class AiBudgetExceededError extends Error {
  constructor() {
    super('Daily AI budget reached');
    this.name = 'AiBudgetExceededError';
  }
}

const storage = new AsyncLocalStorage<AiCallContext>();

export function runWithAiCallContext<T>(context: AiCallContext, run: () => T): T {
  return storage.run(context, run);
}

/**
 * Called by the agent client right before it sends a paid request: reserves the input's
 * size-based cost beyond what is already reserved, or throws AiBudgetExceededError.
 */
export async function beforeAgentCall(inputChars: number, truncated = false): Promise<void> {
  const context = storage.getStore();
  if (!context) return;
  const extraUsd = estimateCostFromChars(context.inputChars + inputChars) - context.reservedUsd;
  if (extraUsd > 0 && context.reserveMore) {
    if (!(await context.reserveMore(extraUsd))) throw new AiBudgetExceededError();
    context.reservedUsd += extraUsd;
  }
  context.reachedAgent = true;
  context.inputChars += inputChars;
  if (truncated) context.inputTruncated = true;
}

/** True when this request's agent input was cut to the LLM limit. */
export function inputWasTruncated(): boolean {
  return storage.getStore()?.inputTruncated === true;
}

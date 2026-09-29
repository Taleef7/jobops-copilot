/**
 * Per-user daily AI budget ceiling (Phase 2 · Workstream G).
 *
 * The budget is enforced by **reserving** the call's estimated cost up front, before any
 * paid work starts. The reservation is atomic (a single check-and-increment in the
 * store), so several concurrent AI requests from the same user can't each read an
 * under-budget value and all proceed past the ceiling. `enforceDailyBudget` guards the
 * `/api/ai` routes; `reserveAiBudget` is the same reservation for paid calls that don't
 * pass through that middleware (e.g. the n8n webhook). Both fail open — a usage-store
 * hiccup must never take the AI routes down.
 */

import type { NextFunction, Request, Response } from 'express';
import { adjustDailyUsage, type Reservation, reserveDailyBudget } from '@/data/usage-store';
import { AiBudgetExceededError, type AiCallContext, runWithAiCallContext } from '@/lib/ai-call-context';
import { dailyBudgetUsd, estimateCallCostUsd } from '@/lib/cost';

export interface BudgetDeps {
  reserve: (userId: string, ceilingUsd: number, costUsd: number, calls?: number) => Promise<Reservation>;
  adjust: (userId: string, deltaUsd: number, deltaCalls: number) => Promise<void>;
}

const defaultDeps: BudgetDeps = { reserve: reserveDailyBudget, adjust: adjustDailyUsage };

/** Per-request state that lets the agent client reserve a large input's extra cost. */
function budgetContext(deps: BudgetDeps, userId: string, reservedUsd: number): AiCallContext {
  return {
    reachedAgent: false,
    inputChars: 0,
    reservedUsd,
    reserveMore: async (usd) => {
      try {
        return (await deps.reserve(userId, dailyBudgetUsd(), usd, 0)).allowed;
      } catch {
        return true; // fail open, like the up-front reservation
      }
    },
  };
}

/** Returned by runWithAiBudget when the daily budget can't cover the call. */
export const BUDGET_SPENT = Symbol('ai budget spent');

/**
 * Run paid agent work that doesn't pass through the budget middleware (discovery, the
 * n8n intake) with the same rules (#345): reserve the flat estimate for `op`, reserve a
 * large input's extra before each agent call, and refund when the agent was never
 * reached. Returns BUDGET_SPENT when the budget can't cover it.
 */
export async function runWithAiBudget<T>(
  userId: string,
  op: string,
  run: () => Promise<T>,
  deps: BudgetDeps = defaultDeps,
): Promise<T | typeof BUDGET_SPENT> {
  const flatUsd = estimateCallCostUsd(op);
  let reserved = false;
  try {
    if (!(await deps.reserve(userId, dailyBudgetUsd(), flatUsd)).allowed) return BUDGET_SPENT;
    reserved = true;
  } catch {
    // Fail open: a usage-store hiccup must not block the call (nothing to refund).
  }
  const context = budgetContext(deps, userId, flatUsd);
  try {
    return await runWithAiCallContext(context, run);
  } catch (error) {
    if (error instanceof AiBudgetExceededError) return BUDGET_SPENT;
    throw error;
  } finally {
    if (reserved && !context.reachedAgent) {
      deps.adjust(userId, -context.reservedUsd, -1).catch(() => undefined);
    }
  }
}

/** Reserve a paid AI call against the user's daily budget; true when it may proceed. */
export async function reserveAiBudget(userId: string, op: string): Promise<boolean> {
  try {
    const { allowed } = await reserveDailyBudget(userId, dailyBudgetUsd(), estimateCallCostUsd(op));
    return allowed;
  } catch {
    return true; // fail open
  }
}

/**
 * Build the budget-guard middleware; the store is injectable for tests.
 *
 * It reserves a flat estimate up front (the atomic ceiling check). Before each paid call
 * the agent client reserves what a large input costs on top, also against the ceiling
 * (lib/ai-call-context.ts). When the response completes, a request that never reached
 * the agent (a 400, a 404, a disabled agent) is refunded (#345).
 */
export function createDailyBudgetGuard(deps: BudgetDeps = defaultDeps) {
  return async function enforceDailyBudget(request: Request, response: Response, next: NextFunction) {
    const userId = request.userId;
    if (!userId) {
      next(); // identity is enforced downstream by requireUser
      return;
    }
    const reservedUsd = estimateCallCostUsd('default');
    try {
      const { allowed } = await deps.reserve(userId, dailyBudgetUsd(), reservedUsd);
      if (!allowed) {
        response.status(429).json({ error: 'Daily AI budget reached' });
        return;
      }
    } catch {
      // Fail open: a usage-store hiccup must not block the user's AI calls.
      next();
      return;
    }

    const context = budgetContext(deps, userId, reservedUsd);
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      // A client that disconnects doesn't stop the handler, which may still call the agent,
      // so only a completed response is settled. An aborted one keeps its reservation.
      if (!response.writableFinished) return;
      if (context.reachedAgent) return;
      deps.adjust(userId, -context.reservedUsd, -1).catch(() => undefined);
    };
    response.once('finish', settle);
    response.once('close', settle);
    runWithAiCallContext(context, () => next());
  };
}

export const enforceDailyBudget = createDailyBudgetGuard();

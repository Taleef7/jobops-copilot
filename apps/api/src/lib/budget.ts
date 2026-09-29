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
import { type AiCallContext, runWithAiCallContext } from '@/lib/ai-call-context';
import { dailyBudgetUsd, estimateCallCostUsd, estimateCostFromChars } from '@/lib/cost';

export interface BudgetDeps {
  reserve: (userId: string, ceilingUsd: number, costUsd: number) => Promise<Reservation>;
  adjust: (userId: string, deltaUsd: number, deltaCalls: number) => Promise<void>;
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
 * It reserves a flat estimate up front (the atomic ceiling check), then settles when the
 * response is done (#345): a request that never reached the agent (a 400, a 404, a
 * disabled agent) is refunded, and one whose input cost more than the reservation is
 * topped up by its size.
 */
export function createDailyBudgetGuard(
  deps: BudgetDeps = { reserve: reserveDailyBudget, adjust: adjustDailyUsage },
) {
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

    const context: AiCallContext = { reachedAgent: false, inputChars: 0 };
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      // A client that disconnects doesn't stop the handler, which may still call the agent,
      // so only a completed response is settled. An aborted one keeps its reservation.
      if (!response.writableFinished) return;
      const [deltaUsd, deltaCalls] = context.reachedAgent
        ? [Math.max(estimateCostFromChars(context.inputChars) - reservedUsd, 0), 0]
        : [-reservedUsd, -1];
      if (deltaUsd === 0 && deltaCalls === 0) return;
      deps.adjust(userId, deltaUsd, deltaCalls).catch(() => undefined);
    };
    response.once('finish', settle);
    response.once('close', settle);
    runWithAiCallContext(context, () => next());
  };
}

export const enforceDailyBudget = createDailyBudgetGuard();

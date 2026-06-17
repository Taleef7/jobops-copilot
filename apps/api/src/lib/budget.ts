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
import { type Reservation, reserveDailyBudget } from '@/data/usage-store';
import { dailyBudgetUsd, estimateCallCostUsd } from '@/lib/cost';

export interface BudgetDeps {
  reserve: (userId: string, ceilingUsd: number, costUsd: number) => Promise<Reservation>;
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

/** Build the budget-guard middleware; the reservation is injectable for tests. */
export function createDailyBudgetGuard(
  deps: BudgetDeps = { reserve: reserveDailyBudget },
) {
  return async function enforceDailyBudget(request: Request, response: Response, next: NextFunction) {
    const userId = request.userId;
    if (!userId) {
      next(); // identity is enforced downstream by requireUser
      return;
    }
    try {
      const { allowed } = await deps.reserve(userId, dailyBudgetUsd(), estimateCallCostUsd('default'));
      if (!allowed) {
        response.status(429).json({ error: 'Daily AI budget reached' });
        return;
      }
    } catch {
      // Fail open: a usage-store hiccup must not block the user's AI calls.
    }
    next();
  };
}

export const enforceDailyBudget = createDailyBudgetGuard();

/**
 * Per-user daily AI budget ceiling (Phase 2 · Workstream G).
 *
 * `enforceDailyBudget` is mounted on the AI routes: it refuses (429) once a user's
 * accumulated spend for the day reaches the configured ceiling. `recordAiUsage` is
 * called by the AI routes after a successful paid call to accrue that day's spend.
 * Both fail open — budget accounting must never take the AI routes down.
 */

import type { NextFunction, Request, Response } from 'express';
import { addUsage, getTodayUsage as defaultGetTodayUsage } from '@/data/usage-store';
import { dailyBudgetUsd, estimateCallCostUsd } from '@/lib/cost';

export interface BudgetDeps {
  getTodayUsage: (userId: string) => Promise<{ costUsd: number; calls: number }>;
}

/** Build the budget-guard middleware; deps are injectable for tests. */
export function createDailyBudgetGuard(
  deps: BudgetDeps = { getTodayUsage: defaultGetTodayUsage },
) {
  return async function enforceDailyBudget(request: Request, response: Response, next: NextFunction) {
    const userId = request.userId;
    if (!userId) {
      next(); // identity is enforced downstream by requireUser
      return;
    }
    try {
      const { costUsd } = await deps.getTodayUsage(userId);
      if (costUsd >= dailyBudgetUsd()) {
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

/** Accrue a successful paid AI call against the user's daily spend (best-effort). */
export async function recordAiUsage(userId: string, op: string): Promise<void> {
  try {
    await addUsage(userId, estimateCallCostUsd(op));
  } catch {
    /* best-effort; never fail the request over usage accounting */
  }
}

/**
 * Cost estimation for the per-user daily AI budget (Phase 2 · Workstream G).
 *
 * A flat per-operation estimate — a guardrail against abuse / runaway loops, not a
 * billing system. The Azure subscription budget (see the cost-controls design) is the
 * real billing backstop. Token-accurate accounting is a possible follow-up.
 */

const DEFAULT_USD = 0.01;

const PER_OP_USD: Record<string, number> = {
  score: 0.01,
  parse: 0.005,
  outreach: 0.01,
  research: 0.02,
};

export function estimateCallCostUsd(op: string): number {
  return PER_OP_USD[op] ?? DEFAULT_USD;
}

export function dailyBudgetUsd(): number {
  return Number(process.env.AI_DAILY_BUDGET_USD ?? 1.0);
}

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

const DEFAULT_DAILY_BUDGET_USD = 1.0;

export function dailyBudgetUsd(): number {
  const raw = process.env.AI_DAILY_BUDGET_USD;
  if (raw === undefined || raw.trim() === '') return DEFAULT_DAILY_BUDGET_USD;
  const parsed = Number(raw);
  // Fail safe to the default on a malformed value. A NaN ceiling would make every
  // budget check pass (`current >= NaN` is always false), silently disabling the cap —
  // the exact "graceful degradation that becomes silently wrong" this audit targets.
  // A deliberate 0 is preserved as a block-all kill-switch (the store denies on
  // `current >= 0`); only negative/non-finite/blank fall back to the default.
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DAILY_BUDGET_USD;
  return parsed;
}

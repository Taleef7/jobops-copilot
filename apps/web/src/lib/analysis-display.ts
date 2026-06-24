/**
 * Display helpers for a job's AI analysis.
 *
 * `mock-fit-scorer-v1` is the one unambiguous "the fit-score agent was unavailable
 * (often a scale-to-zero cold start) and this score is a rule-based heuristic" marker.
 * `mock-analysis-v1` is reused for real-agent parses and the new-job placeholder, so it
 * is NOT a reliable fallback signal and must not trigger the heuristic banner (QA·B).
 */

export const HEURISTIC_FIT_MODEL = 'mock-fit-scorer-v1';

export function isHeuristicAnalysis(modelUsed: string | null | undefined): boolean {
  return modelUsed === HEURISTIC_FIT_MODEL;
}

/**
 * `local-prerank` marks a discovered job's free, estimated fit (keyword overlap
 * only). It upgrades to a real LLM analysis the first time the job is opened.
 */
export const PRERANK_MODEL = 'local-prerank';

export function isPrerankAnalysis(modelUsed: string | null | undefined): boolean {
  return modelUsed === PRERANK_MODEL;
}

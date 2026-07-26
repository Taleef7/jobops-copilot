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

/** Longest skill label we render inline before eliding. */
const MAX_SKILL_LABEL = 48;

/**
 * Reduce a model-authored "missing skill" to something that reads as a skill.
 *
 * The scorer is free-form, so `missing_skills` regularly arrives as reasoning
 * prose rather than a token, e.g.
 *
 *   `"Intelligent automation platforms" (automation is implied via agent
 *    workflows, but the job's wording is not explicitly evidenced)`
 *
 * Rendering that verbatim in a chip list turns the dashboard and the weekly
 * report into walls of model commentary. Prefer a leading quoted phrase, then
 * drop any parenthetical justification, then elide. Callers should keep the raw
 * string as a `title` so the full rationale is still reachable on hover.
 */
export function skillLabel(raw: string): string {
  const text = raw.trim();

  // `"Large Language Models" phrasing is present, but …` → `Large Language Models`
  const quoted = text.match(/^["“”']([^"“”']{2,})["“”']/);
  if (quoted?.[1]) {
    const inner = quoted[1].trim();
    if (inner.length <= MAX_SKILL_LABEL) return inner;
    return `${inner.slice(0, MAX_SKILL_LABEL - 1).trimEnd()}…`;
  }

  // Drop a trailing parenthetical justification, then any clause after the
  // first sentence break.
  const withoutAside = text.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const firstSentence = withoutAside.split(/(?<=[.;])\s+/)[0]?.trim() || withoutAside;
  const cleaned = (firstSentence || text).replace(/[.;,]+$/, '').trim();

  if (cleaned.length <= MAX_SKILL_LABEL) return cleaned;
  return `${cleaned.slice(0, MAX_SKILL_LABEL - 1).trimEnd()}…`;
}

/** True when the label was shortened, so the caller should expose the original. */
export function isSkillLabelTruncated(raw: string): boolean {
  return skillLabel(raw) !== raw.trim();
}

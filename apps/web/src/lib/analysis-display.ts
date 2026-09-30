/**
 * Display helpers for a job's AI analysis.
 *
 * Every analysis is the AI's; when the AI can't answer, nothing is saved (#349), so there
 * is no "heuristic fallback" to flag any more.
 */

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

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

/** "Confidence 65%", or null when there is none. A value of 1 or less is on a 0–1 scale (#354). */
export function confidenceLabel(score: number | null | undefined): string | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return `Confidence ${Math.round(score <= 1 ? score * 100 : score)}%`;
}

/** A sub-signal as "80%", or "unknown" when nothing measured it (#354). */
export function signalLabel(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}%` : 'unknown';
}

/** The API's label for an item that was a sentence, not a skill; the sentence is its evidence. */
export const OTHER_SKILL = 'Other';

/** The labels of some skills, leaving out "Other", which is not a skill. */
export function skillNames(items: ReadonlyArray<{ skill: string }>): string[] {
  return items.map(({ skill }) => skill).filter((skill) => skill !== OTHER_SKILL);
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

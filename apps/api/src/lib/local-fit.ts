import { analysisFromParsed, extractKeywords, parseJobDescription } from '@/lib/analysis-core';
import type { JobAnalysis } from '@/types';

/**
 * Fewest recognised job skills we will divide by before publishing an estimate.
 *
 * The estimate is a ratio, so a tiny denominator can only land on a handful of
 * values: 1 skill yields 0 or 100, 2 skills yield 0/50/100. Those read as
 * confident verdicts ("perfect fit!") while carrying almost no information.
 * Job-board search results make this the common case, not the edge case —
 * Adzuna returns 500-character description snippets, which typically parse to
 * 0–2 recognised skills. Below this floor we report "unknown" instead.
 */
export const MIN_EVIDENCE_SKILLS = 3;

/**
 * Free, deterministic fit estimate: the share of a job's recognised skills that
 * also appear in the user's resume. No LLM, no I/O. Used to pre-rank discovered
 * postings on ingest before the (paid) LLM score runs on first open.
 *
 * Returns `score: null` when there isn't enough evidence to estimate — no
 * resume to compare against, or too few recognised skills in the description.
 * `null` means "not scored yet" (the UI renders an empty ring); it must not be
 * collapsed to 0, which means "scored, and a bad match". Matched skills are
 * still returned when known, since those are observations rather than a verdict.
 */
export function computeLocalFit(
  descriptionText: string,
  resumeText: string,
): { score: number | null; matchedSkills: string[] } {
  const jobSkills = extractKeywords(descriptionText);
  const resumeLower = resumeText.trim().toLowerCase();

  if (!resumeLower) {
    return { score: null, matchedSkills: [] };
  }

  const matchedSkills = jobSkills.filter((skill) => resumeLower.includes(skill.toLowerCase()));

  if (jobSkills.length < MIN_EVIDENCE_SKILLS) {
    return { score: null, matchedSkills };
  }

  const score = Math.round((matchedSkills.length / jobSkills.length) * 100);

  return { score, matchedSkills };
}

/** Sentinel `modelUsed` value marking an estimated (not-yet-LLM-scored) analysis. */
export const PRERANK_MODEL = 'local-prerank';

/**
 * Build the provisional analysis stored for a freshly-discovered posting: the
 * parsed required/preferred skills (so the detail page isn't empty), the
 * local-fit matched skills + score, tagged with the `local-prerank` sentinel so
 * the job-detail page knows to upgrade it with the real LLM score on first open.
 */
export function prerankAnalysis(
  descriptionText: string,
  resumeText: string,
): { fitScore: number | null; analysis: JobAnalysis } {
  const { score, matchedSkills } = computeLocalFit(descriptionText, resumeText);
  const base = analysisFromParsed(parseJobDescription(descriptionText));
  const matched = new Set(matchedSkills);

  return {
    fitScore: score,
    analysis: {
      ...base,
      matchedSkills,
      // Recompute missing from required minus matched so the same skill never
      // shows as both matched and missing in the estimate (analysisFromParsed
      // seeds missingSkills from the required list, before we know matches).
      missingSkills: base.requiredSkills.filter((skill) => !matched.has(skill)),
      modelUsed: PRERANK_MODEL,
    },
  };
}

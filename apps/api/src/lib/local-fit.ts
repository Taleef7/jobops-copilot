import { analysisFromParsed, extractKeywords, parseJobDescription } from '@/lib/analysis-core';
import type { JobAnalysis } from '@/types';

/**
 * Free, deterministic fit estimate: the share of a job's recognised skills that
 * also appear in the user's resume. No LLM, no I/O. Used to pre-rank discovered
 * postings on ingest before the (paid) LLM score runs on first open.
 */
export function computeLocalFit(
  descriptionText: string,
  resumeText: string,
): { score: number; matchedSkills: string[] } {
  const jobSkills = extractKeywords(descriptionText);
  if (jobSkills.length === 0) {
    return { score: 0, matchedSkills: [] };
  }

  const resumeLower = resumeText.toLowerCase();
  const matchedSkills = jobSkills.filter((skill) => resumeLower.includes(skill.toLowerCase()));
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
): { fitScore: number; analysis: JobAnalysis } {
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

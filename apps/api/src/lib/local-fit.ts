import { extractKeywords } from '@/lib/analysis-core';

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

import type { JobRecord, StructuredResume } from '@/types';
import type { TailorAgentRequest } from './answer';
import { editableLines, factsText, flatSkills } from './lines';
import { norm } from './text';

/** The most keywords the tailor window can confirm, and the longest one. */
export const MAX_CONFIRMED_KEYWORDS = 25;
export const MAX_KEYWORD_LENGTH = 60;
const MAX_POSTING_KEYWORDS = 30;

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(norm(trimmed))) continue;
    seen.add(norm(trimmed));
    out.push(trimmed);
  }
  return out;
}

/** The posting's keywords from its fit read (none before one has run). */
export function postingKeywords(job: JobRecord): string[] {
  const analysis = job.analysis;
  if (!analysis) return [];
  return unique([
    ...analysis.requiredSkills,
    ...analysis.preferredSkills,
    ...analysis.atsKeywords,
    ...analysis.missingSkills,
  ]).slice(0, MAX_POSTING_KEYWORDS);
}

/**
 * The confirmed keywords from a request body: trimmed and de-duplicated, or null when the
 * value isn't a list of up to 25 non-empty words of at most 60 characters.
 */
export function parseConfirmedKeywords(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_CONFIRMED_KEYWORDS) return null;
  if (!value.every((item) => typeof item === 'string' && item.trim() && item.trim().length <= MAX_KEYWORD_LENGTH)) {
    return null;
  }
  return unique(value as string[]);
}

/** What the agent is sent: the posting, and the base résumé as read-only facts and lines. */
export function buildTailorRequest(base: StructuredResume, job: JobRecord, confirmedKeywords: string[]): TailorAgentRequest {
  return {
    job_title: job.title,
    company: job.company,
    description_text: job.descriptionText,
    facts: factsText(base),
    lines: editableLines(base).map(({ path, text }) => ({ path, text })),
    skills: flatSkills(base),
    skill_categories: base.skills.map((group) => group.category).filter((category) => category.trim()),
    keywords: postingKeywords(job),
    confirmed_keywords: confirmedKeywords,
  };
}

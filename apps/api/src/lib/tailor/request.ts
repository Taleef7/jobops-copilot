import { LLM_PROFILE_TEXT_MAX } from '@/lib/input-caps';
import type { JobRecord, StructuredResume } from '@/types';
import type { TailorAgentRequest } from './answer';
import { editableLines, factsText, flatSkills } from './lines';
import { norm } from './text';

/** The most keywords the tailor window can confirm, and the longest one. */
export const MAX_CONFIRMED_KEYWORDS = 25;
export const MAX_KEYWORD_LENGTH = 60;
const MAX_POSTING_KEYWORDS = 30;

/**
 * How much of the résumé the agent is sent (the same limit as any résumé text, #345). Lines go
 * whole or not at all, since an edit's old text must match the résumé: the summary first,
 * then bullets in order until the limit, leaving out any one line longer than a bullet can be.
 */
export const MAX_LINE_LENGTH = 1_000;
const MAX_SUMMARY_LENGTH = 3_000;
export const MAX_LINES_LENGTH = LLM_PROFILE_TEXT_MAX;
export const MAX_FACTS_LENGTH = LLM_PROFILE_TEXT_MAX;
const MAX_SKILLS = 200;
const MAX_SKILL_CATEGORIES = 50;

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

// A keyword is one line of plain text: no control, format or private-use characters, no line
// or paragraph separators, and no broken UTF-16 (Postgres refuses NUL in jsonb).
const CONTROL = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u;

/**
 * The confirmed keywords from a request body: trimmed and de-duplicated, or null when the
 * value isn't a list of up to 25 non-empty words of at most 60 characters.
 */
export function parseConfirmedKeywords(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_CONFIRMED_KEYWORDS) return null;
  const isKeyword = (item: unknown) =>
    typeof item === 'string' && item.trim().length > 0 && item.trim().length <= MAX_KEYWORD_LENGTH && !CONTROL.test(item);
  if (!value.every(isKeyword)) return null;
  return unique(value as string[]);
}

/** What the agent is sent: the posting, and the base résumé as read-only facts and lines. */
export function buildTailorRequest(base: StructuredResume, job: JobRecord, confirmedKeywords: string[]): TailorAgentRequest {
  const lines: Array<{ path: string; text: string }> = [];
  let length = 0;
  for (const { path, text } of editableLines(base)) {
    if (text.length > (path === 'basics.summary' ? MAX_SUMMARY_LENGTH : MAX_LINE_LENGTH)) continue;
    if (length + text.length > MAX_LINES_LENGTH) break;
    lines.push({ path, text });
    length += text.length;
  }
  const facts = factsText(base);
  return {
    job_title: job.title,
    company: job.company,
    description_text: job.descriptionText,
    facts: facts.length > MAX_FACTS_LENGTH ? `${facts.slice(0, MAX_FACTS_LENGTH - 30)}\n(the rest is not shown)` : facts,
    lines,
    skills: flatSkills(base).slice(0, MAX_SKILLS),
    skill_categories: base.skills
      .map((group) => group.category)
      .filter((category) => category.trim())
      .slice(0, MAX_SKILL_CATEGORIES),
    keywords: postingKeywords(job),
    confirmed_keywords: confirmedKeywords,
  };
}

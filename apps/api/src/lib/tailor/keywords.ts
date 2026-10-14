import type { StructuredResume } from '@/types';
import { flatSkills, wholeText } from './lines';
import { buildVocab, termsIn, type Vocab } from './terms';
import { escapeRegex, norm } from './text';

/**
 * The posting's keywords against a résumé (#351): which are on it, for the tailor window, and
 * how many, for "Posting keywords in your résumé: 6 of 16 → 11 of 16". A count, not a score.
 */

// Words that start or carry a requirement, not a skill: "Excellent written communication",
// "Bachelor's degree in CS", "5+ years of Go", "Experience with distributed systems".
const REQUIREMENT =
  /^(experience|excellent|strong|solid|proven|demonstrated|ability|able|knowledge|familiarity|understanding|proficiency|bachelor|master|degree|phd)\b|\b(years?|degree)\b|\d\+/i;

/**
 * The fit read's terms that are keywords a person has ("Kafka", "S3", "OAuth 2.0", "Payment
 * APIs"), not requirements written as phrases: confirming one puts it in the skills.
 */
export function keywordTerms(terms: string[]): string[] {
  return terms.filter((term) => term.trim().split(/\s+/).length <= 4 && !REQUIREMENT.test(term.trim()));
}

/** The résumé's text and tools, to check keywords against. */
function resumeIndex(resume: StructuredResume | null, vocab: Vocab) {
  const text = resume ? norm(wholeText(resume)) : '';
  return { text, keys: new Set(resume ? termsIn(wholeText(resume), vocab, { evidence: true }) : []) };
}

function onResume(term: string, index: ReturnType<typeof resumeIndex>, vocab: Vocab): boolean {
  const keys = termsIn(term, vocab, { evidence: true, parts: false });
  if (keys.length > 0) return keys.every((key) => index.keys.has(key));
  // A term the vocabulary doesn't hold (too short, like "UX"): the word itself.
  const word = norm(term);
  return word.length > 0 && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(word)}(?![\\p{L}\\p{N}])`, 'u').test(index.text);
}

/** Each posting keyword, and whether the résumé already has it. */
export function keywordsOnResume(terms: string[], resume: StructuredResume | null): Array<{ term: string; onResume: boolean }> {
  const vocab = buildVocab([...terms, ...(resume ? flatSkills(resume) : [])]);
  const index = resumeIndex(resume, vocab);
  return terms.map((term) => ({ term, onResume: onResume(term, index, vocab) }));
}

/** How many of the posting's keywords a résumé has. */
export function keywordCount(terms: string[], resume: StructuredResume): number {
  const vocab = buildVocab([...terms, ...flatSkills(resume)]);
  const index = resumeIndex(resume, vocab);
  const unique = [...new Map(terms.map((term) => [norm(term), term])).values()];
  return unique.filter((term) => onResume(term, index, vocab)).length;
}

/** How many posting keywords the base résumé and the tailored one each have. */
export function keywordCoverage(
  terms: string[],
  base: StructuredResume,
  tailored: StructuredResume,
): { total: number; before: number; after: number } {
  return {
    total: new Set(terms.map(norm)).size,
    before: keywordCount(terms, base),
    after: keywordCount(terms, tailored),
  };
}

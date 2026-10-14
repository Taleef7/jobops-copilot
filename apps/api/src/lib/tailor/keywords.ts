import type { StructuredResume } from '@/types';
import { flatSkills, wholeText } from './lines';
import { buildVocab, termsIn, type Vocab } from './terms';
import { norm } from './text';

/**
 * The posting's keywords against a résumé (#351): which are on it, for the tailor window, and
 * how many, for "Posting keywords in your résumé: 6 of 16 → 11 of 16". A count, not a score.
 */

/**
 * The fit read's terms that are keywords a person has ("Kafka", "Payment APIs"), not
 * requirements written as phrases ("3+ years of backend development experience"): confirming
 * one puts it in the skills.
 */
export function keywordTerms(terms: string[]): string[] {
  return terms.filter((term) => !/\d/.test(term) && term.trim().split(/\s+/).length <= 4);
}

function onResume(term: string, resumeKeys: Set<string>, vocab: Vocab): boolean {
  const keys = termsIn(term, vocab, { evidence: true, parts: false });
  return keys.length > 0 && keys.every((key) => resumeKeys.has(key));
}

function resumeKeys(resume: StructuredResume | null, vocab: Vocab): Set<string> {
  return new Set(resume ? termsIn(wholeText(resume), vocab, { evidence: true }) : []);
}

/** Each posting keyword, and whether the résumé already has it. */
export function keywordsOnResume(terms: string[], resume: StructuredResume | null): Array<{ term: string; onResume: boolean }> {
  const vocab = buildVocab([...terms, ...(resume ? flatSkills(resume) : [])]);
  const keys = resumeKeys(resume, vocab);
  return terms.map((term) => ({ term, onResume: onResume(term, keys, vocab) }));
}

/** How many posting keywords the base résumé and the tailored one each have. */
export function keywordCoverage(
  terms: string[],
  base: StructuredResume,
  tailored: StructuredResume,
): { total: number; before: number; after: number } {
  const vocab = buildVocab([...terms, ...flatSkills(base), ...flatSkills(tailored)]);
  const before = resumeKeys(base, vocab);
  const after = resumeKeys(tailored, vocab);
  const unique = [...new Map(terms.map((term) => [norm(term), term])).values()];
  return {
    total: unique.length,
    before: unique.filter((term) => onResume(term, before, vocab)).length,
    after: unique.filter((term) => onResume(term, after, vocab)).length,
  };
}

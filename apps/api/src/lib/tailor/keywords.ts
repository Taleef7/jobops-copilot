import type { StructuredResume } from '@/types';
import { flatSkills, wholeText } from './lines';
import { buildVocab, termsIn, type Vocab } from './terms';
import { escapeRegex, norm, plain } from './text';

/**
 * The posting's keywords against a résumé (#351): which are on it, for the tailor window, and
 * how many, for "Posting keywords in your résumé: 6 of 16 → 11 of 16". A count, not a score.
 */

// Requirements written as phrases, not skills: "Experience with distributed systems", "Hands-on
// experience building APIs", "Strong knowledge of SQL", "Strong communication skills",
// "Attention to detail", "Ability to …", "CS degree", "BS/MS in …", "5+ years of Go". Only the
// phrasing counts, so skills with the same words stay ("Experience Design", "User Experience
// Engineering", "Strong typing", "Master Data Management", "Knowledge Graphs", "360-degree
// feedback", "MS SQL Server", "Java 8+").
const REQUIREMENTS = [
  // "Experience with …", "Knowledge of …", "Hands-on experience in …": first, or after one word.
  /^([\p{L}-]+\s+)?(experience|knowledge|familiarity|understanding|proficiency|expertise)\s+(with|in|of|using)\b/iu,
  // "Experience mentoring engineers": experience, a verb, and what it's done to.
  /^([\p{L}-]+\s+)?experience\s+\p{L}{2,}ing\s+\S/iu,
  // "Strong knowledge of …", "Deep understanding of …", "Working knowledge of …".
  /\b(strong|solid|deep|working|good|excellent|thorough|in-depth|proven|hands-on|demonstrated)\s+(knowledge|understanding|experience|grasp|command|familiarity)\b/i,
  /^(excellent|strong|solid|proven|demonstrated|good|great)\b.*\b(skills?|abilit(y|ies)|record|communication|communicator)\b/i,
  // Traits, not skills to list.
  /\b(problem[- ]solving|attention to detail|work ethic|judge?ment|team player|self[- ]starter|interpersonal)\b/i,
  /^(ability|able)\s+to\b/i,
  /\bbachelor|\bmaster'?s\b|\bph\.?\s?d\b|(?<![\d-])\bdegree\b|\b(bs|ms|ba|ma|bsc|msc)\s*(\/|\bin\b)/i,
  /\b\d+\+?\s*(years?|yrs)\b|\byears?\s+of\b/i,
];

/**
 * The fit read's terms that are keywords a person has ("Kafka", "S3", "OAuth 2.0", "Payment
 * APIs"), not requirements written as phrases: confirming one puts it in the skills.
 */
export function keywordTerms(terms: string[]): string[] {
  return terms.filter((term) => {
    const text = term.trim();
    return text.split(/\s+/).length <= 4 && !REQUIREMENTS.some((pattern) => pattern.test(text));
  });
}

/** The posting's keywords once each, as first written. */
function uniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  return terms.filter((term) => {
    const key = norm(term);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The résumé's text and tools, to check keywords against. */
function resumeIndex(resume: StructuredResume | null, vocab: Vocab) {
  const raw = resume ? plain(wholeText(resume)) : '';
  return { raw, text: raw.toLowerCase(), keys: new Set(resume ? termsIn(wholeText(resume), vocab, { evidence: true }) : []) };
}

// A word's edges: "C" isn't in "C++" or "C#", "Go" isn't in "Golang".
const wordIn = (word: string, text: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}+#])${escapeRegex(word)}(?![\\p{L}\\p{N}+#])`, 'u').test(text);

function onResume(term: string, index: ReturnType<typeof resumeIndex>, vocab: Vocab): boolean {
  const keys = termsIn(term, vocab, { evidence: true, parts: false });
  if (keys.length > 0) return keys.every((key) => index.keys.has(key));
  // A term the vocabulary doesn't hold (too short, like "UX"): the word itself. An all-caps one
  // only as written, so "IT" isn't found in "made it work", nor "PM" in "5 pm".
  const word = plain(term).trim();
  if (!word) return false;
  if (/\p{L}/u.test(word) && word === word.toUpperCase()) return wordIn(word, index.raw);
  return wordIn(word.toLowerCase(), index.text);
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
  return uniqueTerms(terms).filter((term) => onResume(term, index, vocab)).length;
}

/**
 * How many posting keywords the base résumé and the tailored one each have, and which keywords
 * were counted: the review recounts the draft against these, not a later fit read's.
 */
export function keywordCoverage(
  terms: string[],
  base: StructuredResume,
  tailored: StructuredResume,
): { total: number; before: number; after: number; terms: string[] } {
  const counted = uniqueTerms(terms);
  return {
    total: counted.length,
    before: keywordCount(counted, base),
    after: keywordCount(counted, tailored),
    terms: counted,
  };
}

import type { GroundingIssue, StructuredResume } from '@/types';
import { findUnsupportedNumbers } from './numbers';
import { displayOf, termsIn, type Vocab } from './terms';
import { roleText, wholeText, type TailorLine } from './lines';
import { ACTION_VERBS, contentTokens, escapeRegex, norm } from './text';

/**
 * The grounding check for one reworded line (#351, SPEC rule 6). A line may reword and
 * reorder what its source already says; it may not add a number, a date, a tool, an employer,
 * a degree or a seniority. A blocking issue drops the suggestion and the résumé keeps the base
 * line. Deterministic, and it fails closed: the model's own account of its edits is never
 * trusted.
 *
 * Evidence, per kind of line:
 * - a bullet: numbers from that bullet; tools from its role (title, company, every bullet);
 * - the summary: anything in the base résumé.
 * Keywords the user confirmed in the tailor window count as theirs anywhere.
 */

export const BLOCKING = new Set<GroundingIssue['code']>([
  'INVALID_PATH',
  'EMPTY_LINE',
  'NOT_A_REWRITE',
  'NEW_NUMBER',
  'NEW_DATE',
  'NEW_SKILL',
  'NEW_ENTITY',
  'NEW_SENIORITY',
]);

export interface CheckContext {
  base: StructuredResume;
  vocab: Vocab;
  /** The posting's company. */
  company: string;
  confirmedKeywords: string[];
}

export interface LineCheck {
  issues: GroundingIssue[];
  /** Confirmed keywords the line uses that its source doesn't: shown as "which you added". */
  confirmedTerms: string[];
}

const COMPANY_SUFFIX = /[\s,]+(inc\.?|incorporated|llc|l\.l\.c\.|ltd\.?|limited|corp\.?|corporation|co\.?|company|gmbh|plc|ag|s\.a\.)$/i;

/** "Acme Pay Inc." → "Acme Pay". */
export function companyName(company: string): string {
  let name = company.trim();
  for (let previous = ''; previous !== name; ) {
    previous = name;
    name = name.replace(COMPANY_SUFFIX, '').trim();
  }
  return name;
}

const DEGREE = /(?<![\p{L}\p{N}.])(ph\.?\s?d\.?|doctorate|master'?s|masters|m\.?sc|m\.s\.|mba|bachelor'?s|bachelors|b\.?sc|b\.s\.|b\.a\.|m\.a\.)(?![\p{L}\p{N}])/gu;

const SENIORITY =
  /(?<![\p{L}\p{N}])(senior|sr\.?|staff|principal|lead|chief|head)(?![\p{L}\p{N}])(?:\s+[\p{L}-]+){0,2}?\s+(engineers?|developers?|scientists?|analysts?|designers?|architects?|managers?|consultants?|researchers?|programmers?)(?![\p{L}])/gu;

/** Verbs that claim leading or owning work, by family. */
const LEADERSHIP: Array<[string, RegExp]> = [
  ['lead', /\b(led|leading)\b/],
  ['manage', /\bmanag(e|ed|es|ing)\b/],
  ['own', /\b(owned|owning)\b/],
  ['head', /\bhead(ed|ing)\b/],
  ['direct', /\bdirect(ed|ing)\b/],
  ['spearhead', /\bspearhead(ed|ing|s)?\b/],
  ['mentor', /\bmentor(ed|ing|s)?\b/],
  ['supervise', /\bsupervis(e|ed|es|ing)\b/],
  ['hire', /\bhir(e|ed|es|ing)\b/],
  ['oversee', /\b(oversaw|oversee|oversees|overseeing|overseen)\b/],
];

const has = (haystack: string, needle: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(needle)}(?![\\p{L}\\p{N}])`, 'u').test(haystack);

export function checkLine(line: TailorLine, newText: string, ctx: CheckContext): LineCheck {
  const issues: GroundingIssue[] = [];
  const confirmedTerms: string[] = [];
  const isSummary = line.role === null;
  const everything = wholeText(ctx.base);
  const confirmedText = ctx.confirmedKeywords.join('\n');
  const toolEvidence = isSummary ? everything : roleText(ctx.base, line.role!);
  const lowerNew = norm(newText);
  const lowerEverything = norm(everything);

  // A rewording keeps what the line is about: at least two of its words (one, if it has one
  // besides its verbs). A shared verb counts, since "build" in "build time" is a noun, but a
  // line of verbs only needs no other word.
  const sourceTokens = new Set(contentTokens(line.text));
  const subject = [...sourceTokens].filter((token) => !ACTION_VERBS.has(token));
  const kept = new Set(contentTokens(newText).filter((token) => sourceTokens.has(token)));
  if (kept.size < Math.min(2, subject.length)) {
    issues.push({ code: 'NOT_A_REWRITE', message: "isn't a rewording of the original line" });
  }

  const numberEvidence = `${isSummary ? everything : line.text}\n${confirmedText}`;
  for (const number of findUnsupportedNumbers(newText, numberEvidence)) {
    issues.push(
      number.year
        ? { code: 'NEW_DATE', term: number.raw, message: `adds the date ${number.raw}, which isn't in your base résumé` }
        : {
            code: 'NEW_NUMBER',
            term: number.raw,
            message: `adds the number ${number.raw}, which ${isSummary ? "isn't in your base résumé" : "the original line doesn't have"}`,
          },
    );
  }

  const known = new Set(termsIn(toolEvidence, ctx.vocab));
  const confirmed = new Set(termsIn(confirmedText, ctx.vocab));
  for (const key of termsIn(newText, ctx.vocab)) {
    if (known.has(key)) continue;
    const term = displayOf(key, ctx.vocab);
    if (confirmed.has(key)) {
      const asTyped = ctx.confirmedKeywords.find((keyword) => termsIn(keyword, ctx.vocab).includes(key));
      confirmedTerms.push(asTyped ?? term);
      continue;
    }
    issues.push({
      code: 'NEW_SKILL',
      term,
      message: `adds ${term}, which ${isSummary ? "isn't in your base résumé" : "this role doesn't mention"}`,
    });
  }

  const company = companyName(ctx.company);
  if (company.length >= 2 && has(lowerNew, norm(company)) && !has(lowerEverything, norm(company))) {
    issues.push({ code: 'NEW_ENTITY', term: company, message: `names ${company}, which isn't in your base résumé` });
  }
  for (const match of lowerNew.matchAll(DEGREE)) {
    const degree = match[1]!;
    if (!lowerEverything.match(DEGREE)?.some((found) => found.replace(/[.'\s]/g, '') === degree.replace(/[.'\s]/g, ''))) {
      issues.push({ code: 'NEW_ENTITY', term: degree, message: `adds a degree (${degree}) that isn't in your base résumé` });
    }
  }

  const seniorityEvidence = norm(isSummary ? everything : toolEvidence);
  for (const match of lowerNew.matchAll(SENIORITY)) {
    const word = match[1]!.replace(/\.$/, '');
    if (!has(seniorityEvidence, word)) {
      issues.push({ code: 'NEW_SENIORITY', term: word, message: `says "${word}", a seniority your base résumé doesn't state` });
    }
  }

  const lowerSource = norm(line.text);
  for (const [, verb] of LEADERSHIP) {
    const found = verb.exec(lowerNew);
    if (found && !verb.test(lowerSource)) {
      issues.push({ code: 'LEADERSHIP_CLAIM', term: found[0], message: `says "${found[0]}", which the original line doesn't` });
    }
  }

  return { issues, confirmedTerms };
}

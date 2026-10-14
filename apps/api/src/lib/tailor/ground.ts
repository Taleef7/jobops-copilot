import type { GroundingIssue, StructuredResume } from '@/types';
import { extractNumbers, findUnsupportedNumbers } from './numbers';
import { displayOf, termsIn, type Vocab } from './terms';
import { roleText, wholeText, type TailorLine } from './lines';
import { ACTION_VERBS, contentTokens, escapeRegex, mixedScriptWords, norm, plain, stem, wordStems } from './text';

/**
 * The grounding check for one reworded line (#351, SPEC rule 6). A line may reword and
 * reorder what its source already says; it may not add a number, a date, a tool, a name, a
 * degree or a title. A blocking issue drops the suggestion and the résumé keeps the base line.
 * Deterministic, and it fails closed: the model's own account of its edits is never trusted.
 *
 * Evidence, per kind of line:
 * - a bullet: numbers from that bullet; tools from its role (title, company, every bullet);
 * - the summary: anything in the base résumé, except that years of experience must already
 *   be in the summary or headline;
 * - names: anywhere in the base résumé; titles: the résumé's job titles, headline and summary.
 * Keywords the user confirmed in the tailor window are theirs: allowed anywhere, and marked.
 */

export const BLOCKING = new Set<GroundingIssue['code']>([
  'INVALID_PATH',
  'EMPTY_LINE',
  'NOT_A_REWRITE',
  'NEW_NUMBER',
  'NEW_DATE',
  'NEW_SKILL',
  'NEW_TERM',
  'NEW_ENTITY',
  'NEW_SENIORITY',
  'ODD_CHARACTERS',
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

const COMPANY_SUFFIX =
  /[\s,]+(gmbh\s*&\s*co\.?\s*kg|inc\.?|incorporated|llc|l\.l\.c\.|ltd\.?|limited|corp\.?|corporation|co\.?|company|gmbh|plc|ag|s\.a\.)$/i;

/** "Acme Pay Inc." → "Acme Pay"; "Acme Pay · Remote" and "Acme Pay (Fintech)" → "Acme Pay". */
export function companyName(company: string): string {
  let name = company.split(/\s+[·|(–—]\s*|\s+-\s+|,\s*/)[0]!.trim();
  for (let previous = ''; previous !== name; ) {
    previous = name;
    name = name.replace(COMPANY_SUFFIX, '').trim();
  }
  return name;
}

const has = (haystack: string, needle: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(needle)}(?![\\p{L}\\p{N}])`, 'u').test(haystack);

/** Degrees by family, in their usual spellings ("MSc", "M.S.", "Master of Science", "MS in"). */
const DEGREES: Array<[string, RegExp]> = [
  ['doctorate', /(?<![\p{L}])(ph\.?\s?d\.?|doctorate|doctoral)(?![\p{L}])/u],
  ['MBA', /(?<![\p{L}])m\.?b\.?a\.?(?![\p{L}])/u],
  [
    "master's degree",
    /(?<![\p{L}])(master'?s?|m\.?\s?sc\.?|m\.s\.?|m\.a\.|m\.?eng|m\.?tech|graduate degree|postgraduate)(?![\p{L}])|(?<![\p{L}])(ms|ma)\s+in(?![\p{L}])/u,
  ],
  [
    "bachelor's degree",
    /(?<![\p{L}])(bachelor'?s?|b\.?\s?sc\.?|b\.s\.?|b\.a\.|b\.?eng|b\.?tech)(?![\p{L}])|(?<![\p{L}])(bs|ba)\s+in(?![\p{L}])/u,
  ],
];
const degreesIn = (text: string) => DEGREES.filter(([, pattern]) => pattern.test(norm(text))).map(([name]) => name);

/** A seniority before a role ("senior backend engineer"); plural roles are other people. */
const ROLE = '(?:engineer|developer|dev|scientist|analyst|designer|architect|manager|consultant|researcher|programmer|sre|lead)';
const SENIORITY = new RegExp(
  `(?<![\\p{L}])(senior|sr\\.?|staff|principal|lead|chief|head)(?:-level)?(?![\\p{L}])(?:\\s+[\\p{L}-]+){0,3}?\\s+${ROLE}(?![\\p{L}])`,
  'gu',
);
const LEVEL = /(?<![\p{L}])(senior|staff|principal)-level(?![\p{L}])/gu;
/** Titles without a seniority word. */
const TITLE =
  /(?<![\p{L}])((?:tech|team|technical|engineering|product|project|program|delivery|development)\s+(?:lead|manager|director)|head of [\p{L}]+|director|vice president|vp|cto|ceo|cfo|coo|co-founder|founder|architect|(?:engineer|developer)\s+(?:i{1,3}|iv|[1-5]))(?![\p{L}])/gu;

/** Verbs that claim leading or owning work, by family. Kept, but marked for review. */
const LEADERSHIP: RegExp[] = [
  /\b(led|leading)\b/,
  /\bmanag(e|ed|es|ing)\b/,
  /\b(owned|owning)\b/,
  /\bhead(ed|ing)\b/,
  /\bdirect(ed|ing)\b/,
  /\bspearhead(ed|ing|s)?\b/,
  /\bmentor(ed|ing|s)?\b/,
  /\bsupervis(e|ed|es|ing)\b/,
  /\bhir(e|ed|es|ing)\b/,
  /\b(oversaw|oversee|oversees|overseeing|overseen)\b/,
];

/** Acronyms and words that are not names of anything the résumé has to have. */
const GENERIC = new Set(
  ['api', 'ui', 'ux', 'us', 'u.s', 'usa', 'uk', 'eu', 'ceo', 'cto', 'cfo', 'coo', 'vp', 'hr', 'it', 'kpi', 'sla',
    'roi', 'b2b', 'b2c', 'id', 'ok', 'faq', 'pr', 'qa', 'i'],
);

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}+#]*(?:[.'][\p{L}\p{N}+#]+)*/gu;

function atSentenceStart(text: string, index: number): boolean {
  const before = text.slice(0, index).replace(/[ \t"'([•·*-]+$/u, '');
  return before === '' || /[.!?:;\n]$/.test(before);
}

/**
 * Names in the line that the base résumé never mentions: acronyms, CamelCase and words with
 * digits anywhere ("ClickHouse", "p99"), and capitalised words mid-sentence ("Memcached",
 * "Hooli"). Tools the vocabulary knows and degrees are checked on their own.
 */
function newNames(text: string, known: Set<string>, vocab: Vocab): string[] {
  const source = plain(text);
  const names: string[] = [];
  for (const match of source.matchAll(TOKEN)) {
    const token = match[0];
    const strong = /\p{Lu}.*\p{Lu}/u.test(token) || (/\p{L}/u.test(token) && /\p{N}/u.test(token));
    if (!strong && !(/^\p{Lu}/u.test(token) && !atSentenceStart(source, match.index ?? 0))) continue;
    if (/^\d+(st|nd|rd|th|s|k|m|x)?$/i.test(token)) continue;
    const lower = token.toLowerCase();
    if (GENERIC.has(lower) || GENERIC.has(stem(lower)) || known.has(stem(lower))) continue;
    if (termsIn(token, vocab).length > 0 || degreesIn(token).length > 0) continue;
    if (!names.includes(token)) names.push(token);
  }
  return names;
}

/** The line without the confirmed keywords, so "React 18" lends no 18 to a number check. */
function withoutKeywords(text: string, keywords: string[]): string {
  return keywords.reduce(
    (out, keyword) => out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(keyword)}(?![\\p{L}\\p{N}])`, 'giu'), ' '),
    plain(text),
  );
}

export function checkLine(line: TailorLine, newText: string, ctx: CheckContext): LineCheck {
  const issues: GroundingIssue[] = [];
  const confirmedTerms: string[] = [];
  const isSummary = line.role === null;
  const { base } = ctx;
  const everything = wholeText(base);
  const confirmedText = ctx.confirmedKeywords.join('\n');
  const toolEvidence = isSummary ? everything : roleText(base, line.role!);
  const lowerNew = norm(newText);
  const lowerEverything = norm(everything);

  for (const word of mixedScriptWords(newText)) {
    if (!everything.includes(word)) {
      issues.push({ code: 'ODD_CHARACTERS', term: word, message: `writes "${word}" with look-alike letters` });
    }
  }

  // A rewording keeps what the line is about, and doesn't add much it doesn't say.
  const sourceTokens = new Set(contentTokens(line.text));
  const subject = [...sourceTokens].filter((token) => !ACTION_VERBS.has(token));
  const newTokens = contentTokens(newText);
  const kept = new Set(newTokens.filter((token) => sourceTokens.has(token)));
  const said = wordStems(`${toolEvidence}\n${confirmedText}`);
  const novel = new Set(newTokens.filter((token) => !ACTION_VERBS.has(token) && !said.has(token)));
  if (kept.size < (subject.length >= 4 ? 2 : Math.min(1, subject.length))) {
    issues.push({ code: 'NOT_A_REWRITE', message: "isn't a rewording of the original line" });
  } else if (!isSummary && novel.size > Math.max(3, subject.length)) {
    issues.push({ code: 'NOT_A_REWRITE', message: 'adds more than the original line says' });
  }

  // Numbers: a confirmed keyword's digits ("React 18") are not a claim.
  const numberText = withoutKeywords(newText, ctx.confirmedKeywords);
  const unsupported = findUnsupportedNumbers(numberText, isSummary ? everything : line.text);
  if (isSummary) {
    // "N years of experience" must already be in the summary or headline.
    const stated = `${base.basics.summary ?? ''}\n${base.basics.label ?? ''}`;
    for (const number of extractNumbers(numberText)) {
      if ((number.unit === 't:year' || number.unit === 't:month') && !unsupported.some((u) => u.raw === number.raw)) {
        if (findUnsupportedNumbers(number.raw, stated).length > 0) unsupported.push(number);
      }
    }
  }
  for (const number of unsupported) {
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

  // Tools: from the line's role (a bullet) or anywhere (the summary), or confirmed.
  const known = new Set(termsIn(toolEvidence, ctx.vocab, { evidence: true }));
  const confirmed = new Set(termsIn(confirmedText, ctx.vocab, { evidence: true }));
  for (const key of termsIn(newText, ctx.vocab)) {
    if (known.has(key)) continue;
    const term = displayOf(key, ctx.vocab);
    if (confirmed.has(key)) {
      const asTyped = ctx.confirmedKeywords.find((keyword) => termsIn(keyword, ctx.vocab, { evidence: true }).includes(key));
      confirmedTerms.push(asTyped ?? term);
      continue;
    }
    issues.push({
      code: 'NEW_SKILL',
      term,
      message: `adds ${term}, which ${isSummary ? "isn't in your base résumé" : "this role doesn't mention"}`,
    });
  }

  // Names the résumé never mentions: another employer, a product, a tool the list lacks.
  for (const name of newNames(newText, wordStems(`${everything}\n${confirmedText}`), ctx.vocab)) {
    issues.push({ code: 'NEW_TERM', term: name, message: `adds "${name}", which isn't in your base résumé` });
  }

  const company = companyName(ctx.company);
  if (company.length >= 2) {
    const words = norm(company).split(/[\s-]+/).filter(Boolean).map(escapeRegex);
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${words.join('[\\s-]*')}(?![\\p{L}\\p{N}])`, 'u');
    if (pattern.test(lowerNew) && !pattern.test(lowerEverything)) {
      issues.push({ code: 'NEW_ENTITY', term: company, message: `names ${company}, which isn't in your base résumé` });
    }
  }

  const degrees = new Set(degreesIn(everything));
  for (const degree of degreesIn(newText)) {
    if (!degrees.has(degree)) {
      issues.push({ code: 'NEW_ENTITY', term: degree, message: `adds a ${degree}, which isn't in your base résumé` });
    }
  }

  // Titles: only the résumé's own job titles, headline and summary are evidence.
  const titles = norm([...base.work.map((role) => role.position), base.basics.label, base.basics.summary].join('\n'));
  const claims = new Set<string>();
  for (const match of lowerNew.matchAll(SENIORITY)) claims.add(match[1]!.replace(/\.$/, ''));
  for (const match of lowerNew.matchAll(LEVEL)) claims.add(match[1]!);
  for (const match of lowerNew.matchAll(TITLE)) claims.add(match[1]!);
  for (const claim of claims) {
    if (!has(titles, claim)) {
      issues.push({ code: 'NEW_SENIORITY', term: claim, message: `claims "${claim}", a title your base résumé doesn't have` });
    }
  }

  const lowerSource = norm(line.text);
  for (const verb of LEADERSHIP) {
    const found = verb.exec(lowerNew);
    if (found && !verb.test(lowerSource)) {
      issues.push({ code: 'LEADERSHIP_CLAIM', term: found[0], message: `says "${found[0]}", which the original line doesn't` });
    }
  }

  return { issues, confirmedTerms };
}

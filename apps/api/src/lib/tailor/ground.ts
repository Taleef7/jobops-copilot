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
 * - names: anywhere in the base résumé; titles: the résumé's job titles, headline and summary,
 *   and the line itself.
 * Keywords the user confirmed in the tailor window are theirs: allowed anywhere, and marked.
 *
 * Some signals are too often honest to drop on: an ordinary capitalised word or a short
 * acronym the résumé lacks ("Registered Nurse (RN)", "Microsoft Excel"), a leadership verb.
 * Those lines are kept and marked for review instead.
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

/** What a suggestion is checked against, worked out once per tailoring. */
export interface Evidence {
  everything: string;
  everythingPlain: string;
  everythingLower: string;
  /** Word stems of the résumé and the confirmed keywords: what a name is checked against. */
  knownWords: Set<string>;
  /** Tools anywhere in the résumé. */
  allTools: Set<string>;
  degrees: Set<string>;
  /** The résumé's job titles, headline and summary, for title claims. */
  titles: string;
  roles: Map<number, { text: string; words: Set<string>; tools: Set<string> }>;
  confirmedText: string;
  confirmedTools: Set<string>;
}

export interface CheckContext {
  base: StructuredResume;
  vocab: Vocab;
  /** The posting's company. */
  company: string;
  confirmedKeywords: string[];
  evidence: Evidence;
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

const wordPattern = (needle: string, flags = 'u') =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(needle)}(?![\\p{L}\\p{N}])`, flags);
const has = (haystack: string, needle: string) => wordPattern(needle).test(haystack);
const countOf = (haystack: string, needle: string) => (haystack.match(wordPattern(needle, 'gu')) ?? []).length;

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

/** Text for title matching: "Vice President" is "VP", "head-of" is "head of". */
const titleText = (text: string) =>
  norm(text).replace(/\bvice[\s-]president\b/g, 'vp').replace(/\bhead-of\b/g, 'head of');

const ROLE =
  '(?:engineer|developer|dev|scientist|analyst|designer|architect|manager|consultant|researcher|programmer|sre|lead|leader|supervisor)';
/** A seniority before a role ("senior backend engineer"); plural roles are other people. */
const SENIORITY = new RegExp(
  `(?<![\\p{L}])(senior|sr\\.?|staff|principal|lead|chief|head)(?:-level)?(?![\\p{L}])(?:\\s+[\\p{L}-]+){0,3}?\\s+${ROLE}(?![\\p{L}])`,
  'gu',
);
const LEVEL = /(?<![\p{L}])(senior|staff|principal)-level(?![\p{L}])/gu;
/** Titles without a seniority word. */
const TITLE =
  /(?<![\p{L}])((?:tech|team|technical|engineering|product|project|program|delivery|development)\s+(?:lead|manager|director)|head of [\p{L}]+|director|vp|cto|ceo|cfo|coo|co-founder|founder|architect|(?:engineer|developer)\s+(?:i{1,3}|iv|[1-5]))(?![\p{L}])/gu;
/** The summary describing the person: "Backend lead who…", "Backend engineer and payments manager…". */
const SELF_TITLE = /(?:^|[.!?;]\s+)(?:[\p{L}-]+\s+){0,5}?(lead|leader|manager|supervisor|director|head|architect|principal)(?![\p{L}])/gu;
const PROMOTED =
  /\bpromoted to (?:a |an |the )?((?:[\p{L}-]+\s+){0,2}?(?:lead|leader|manager|supervisor|director|head|architect|engineer|developer|analyst|nurse|specialist|consultant))(?![\p{L}])/gu;

function titleClaims(text: string, isSummary: boolean): string[] {
  const claims = new Set<string>();
  for (const match of text.matchAll(SENIORITY)) claims.add(match[1]!.replace(/\.$/, ''));
  for (const match of text.matchAll(LEVEL)) claims.add(match[1]!);
  for (const match of text.matchAll(TITLE)) claims.add(match[1]!);
  for (const match of text.matchAll(PROMOTED)) claims.add(match[1]!.trim());
  if (isSummary) for (const match of text.matchAll(SELF_TITLE)) claims.add(match[1]!);
  return [...claims];
}

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
    'roi', 'b2b', 'b2c', 'id', 'ok', 'faq', 'pr', 'qa'],
);

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}+#]*(?:[.'][\p{L}\p{N}+#]+)*/gu;
const SKIP_BACK = new Set([' ', '\t', '"', "'", '(', '[', '•', '·', '*', '-']);

/** The token at `index` starts a sentence (looking back past spaces, quotes and bullets). */
function atSentenceStart(text: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && SKIP_BACK.has(text[i]!)) i -= 1;
  return i < 0 || '.!?:;\n'.includes(text[i]!);
}

/**
 * Names in the line that the base résumé never mentions. Strong signs of a name, dropped:
 * CamelCase ("ClickHouse"), letters with digits ("p99"), and all capitals of five letters or
 * more ("EXPERIENCE"). Weak signs, kept but marked for review: a short acronym ("RN") or a
 * capitalised word mid-sentence ("Memcached", "Microsoft"). Numbers, known tools and degrees are
 * checked on their own.
 */
function newNames(text: string, known: Set<string>, vocab: Vocab): { strong: string[]; weak: string[] } {
  const source = plain(text);
  const strong: string[] = [];
  const weak: string[] = [];
  for (const match of source.matchAll(TOKEN)) {
    const token = match[0];
    if (token.length < 2 || /^\p{N}/u.test(token)) continue;
    const isStrong =
      (token.length >= 4 && /\p{Ll}\p{Lu}/u.test(token)) || /\p{N}/u.test(token) || /^\p{Lu}{5,}s?$/u.test(token);
    const isAcronym = /^\p{Lu}{2,4}s?$/u.test(token);
    const isCapitalised = /^\p{Lu}/u.test(token) && !atSentenceStart(source, match.index ?? 0);
    if (!isStrong && !isAcronym && !isCapitalised) continue;
    const lower = token.toLowerCase();
    if (GENERIC.has(lower) || GENERIC.has(stem(lower)) || known.has(stem(lower))) continue;
    if (termsIn(token, vocab).length > 0 || degreesIn(token).length > 0) continue;
    const list = isStrong ? strong : weak;
    if (!list.includes(token)) list.push(token);
  }
  return { strong, weak };
}

/** The line without the confirmed keywords, so "React 18" lends no 18 to a number check. */
function withoutKeywords(text: string, keywords: string[]): string {
  return keywords.reduce((out, keyword) => out.replace(wordPattern(keyword, 'giu'), ' '), plain(text));
}

/** Everything a suggestion is checked against, worked out once per tailoring. */
export function prepareEvidence(base: StructuredResume, vocab: Vocab, confirmedKeywords: string[]): Evidence {
  const everything = wholeText(base);
  const confirmedText = confirmedKeywords.join('\n');
  const confirmedWords = wordStems(confirmedText);
  const roles = new Map<number, { text: string; words: Set<string>; tools: Set<string> }>();
  base.work.forEach((_role, i) => {
    const text = roleText(base, i);
    roles.set(i, {
      text,
      words: new Set([...wordStems(text), ...confirmedWords]),
      tools: new Set(termsIn(text, vocab, { evidence: true })),
    });
  });
  return {
    everything,
    everythingPlain: plain(everything),
    everythingLower: norm(everything),
    knownWords: new Set([...wordStems(everything), ...confirmedWords]),
    allTools: new Set(termsIn(everything, vocab, { evidence: true })),
    degrees: new Set(degreesIn(everything)),
    titles: titleText([...base.work.map((role) => role.position), base.basics.label, base.basics.summary].join('\n')),
    roles,
    confirmedText,
    confirmedTools: new Set(termsIn(confirmedText, vocab, { evidence: true })),
  };
}

export function checkLine(line: TailorLine, newText: string, ctx: CheckContext): LineCheck {
  const issues: GroundingIssue[] = [];
  const confirmedTerms: string[] = [];
  const isSummary = line.role === null;
  const { base, evidence } = ctx;

  // A suggestion far longer than its line isn't a rewording; stop before reading all of it.
  if (newText.length > Math.max(2 * line.text.length, line.text.length + 300)) {
    return { issues: [{ code: 'NOT_A_REWRITE', message: 'is much longer than the original line' }], confirmedTerms };
  }

  const role = isSummary ? null : evidence.roles.get(line.role!)!;
  const lowerNew = norm(newText);

  for (const word of mixedScriptWords(newText)) {
    if (!evidence.everythingPlain.includes(word)) {
      issues.push({ code: 'ODD_CHARACTERS', term: word, message: `writes "${word}" with look-alike letters` });
    }
  }

  // A rewording keeps what the line is about, and doesn't add much it doesn't say.
  const sourceTokens = new Set(contentTokens(line.text));
  const subject = [...sourceTokens].filter((token) => !ACTION_VERBS.has(token));
  const newTokens = contentTokens(newText);
  const kept = new Set(newTokens.filter((token) => sourceTokens.has(token)));
  if (kept.size < (subject.length >= 4 ? 2 : Math.min(1, subject.length))) {
    issues.push({ code: 'NOT_A_REWRITE', message: "isn't a rewording of the original line" });
  } else if (role) {
    const novel = new Set(newTokens.filter((token) => !ACTION_VERBS.has(token) && !role.words.has(token)));
    if (novel.size > Math.max(3, subject.length)) {
      issues.push({ code: 'NOT_A_REWRITE', message: 'adds more than the original line says' });
    }
  }

  // Numbers: a confirmed keyword's digits ("React 18") are not a claim.
  const numberText = withoutKeywords(newText, ctx.confirmedKeywords);
  const unsupported = findUnsupportedNumbers(numberText, isSummary ? evidence.everything : line.text);
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
  const known = role ? role.tools : evidence.allTools;
  for (const key of termsIn(newText, ctx.vocab)) {
    if (known.has(key)) continue;
    const term = displayOf(key, ctx.vocab);
    if (evidence.confirmedTools.has(key)) {
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
  const names = newNames(newText, evidence.knownWords, ctx.vocab);
  for (const name of names.strong) {
    issues.push({ code: 'NEW_TERM', term: name, message: `adds "${name}", which isn't in your base résumé` });
  }
  for (const name of names.weak) {
    issues.push({ code: 'NEW_NAME', term: name, message: `mentions "${name}", which isn't in your base résumé` });
  }

  // The posting's company: a one-word name only as written ("Target", not "target").
  const company = companyName(ctx.company);
  if (company.length >= 2) {
    const words = company.split(/[\s-]+/).filter(Boolean);
    const asWritten = plain(newText);
    const named =
      words.length === 1
        ? has(asWritten, words[0]!) && !has(evidence.everythingPlain, words[0]!)
        : (new RegExp(`(?<![\\p{L}\\p{N}])${words.map((w) => escapeRegex(norm(w))).join('[\\s-]*')}(?![\\p{L}\\p{N}])`, 'u').test(
            lowerNew,
          ) ||
            (words[0]!.length >= 4 && has(asWritten, words[0]!))) &&
          !has(evidence.everythingLower, norm(words[0]!));
    if (named) issues.push({ code: 'NEW_ENTITY', term: company, message: `names ${company}, which isn't in your base résumé` });
  }

  for (const degree of degreesIn(newText)) {
    if (!evidence.degrees.has(degree)) {
      issues.push({ code: 'NEW_ENTITY', term: degree, message: `adds a ${degree}, which isn't in your base résumé` });
    }
  }

  // Titles: the résumé's own titles, headline and summary, and what the line already says.
  const newTitles = titleText(newText);
  const sourceTitles = titleText(line.text);
  for (const claim of titleClaims(newTitles, isSummary)) {
    if (countOf(newTitles, claim) > countOf(evidence.titles, claim) + countOf(sourceTitles, claim)) {
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

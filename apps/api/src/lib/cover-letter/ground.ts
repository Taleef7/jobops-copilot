import type { CoverLetterCheck, GroundingIssue, JobRecord, StructuredResume } from '@/types';
import {
  BLOCKING,
  companyName,
  degreesIn,
  heldTitles,
  LEADERSHIP,
  newNames,
  prepareEvidence,
  titleClaims,
  titleText,
  type Evidence,
} from '@/lib/tailor/ground';
import { factsText, flatSkills } from '@/lib/tailor/lines';
import { extractNumbers, findUnsupportedNumbers } from '@/lib/tailor/numbers';
import { buildVocab, displayOf, termsIn, type Vocab } from '@/lib/tailor/terms';
import { escapeRegex, mixedScriptWords, norm, plain, stem, wordStems } from '@/lib/tailor/text';

/**
 * The cover letter's check (#416, SPEC rule 6). Every claim about the candidate must come from
 * the base résumé or a keyword they confirmed in the tailor window; the company and the role
 * come from the posting. The letter is checked a sentence at a time, and a sentence that adds a
 * number, a date, a tool, an employer, a credential or a title is dropped: the rest of the
 * letter stays, and the review shows what was dropped and why. Deterministic; it fails closed.
 *
 * It is the tailoring check (lib/tailor/ground.ts) read for a letter, with the same evidence,
 * vocabulary, number reader, name and title patterns. What differs:
 * - a letter has no source line, so its sentences are checked against the whole résumé, as
 *   the tailored summary is, and its dates (the facts the tailoring model is sent) count;
 * - the company, and the role where the letter applies for it ("the Backend Engineer role",
 *   "join Acme as a Backend Engineer"), are not claims. Saying you worked with the company, or
 *   held the role, is;
 * - a name in neither the résumé nor the posting is dropped, not only marked: a letter has no
 *   reason to name anything else. A name from the posting is dropped too when the sentence
 *   claims it ("I have used Temporal"), and only marked when it doesn't ("I'd enjoy working on
 *   PayLink"), since the reader has to tell those apart;
 * - a sentence about the company, with no "I" in it, may use the posting's numbers;
 * - a credential the résumé doesn't name ("licensed", "clearance") and a gap to fill in
 *   ("[Start Date]") are dropped.
 */

export interface LetterContext {
  base: StructuredResume;
  job: Pick<JobRecord, 'title' | 'company' | 'descriptionText'>;
  /** The posting's keywords from the fit read: what the model might be tempted to claim. */
  jobTerms: string[];
  /** Keywords the user confirmed having in the tailor window. */
  confirmedKeywords: string[];
}

export interface GroundedLetter {
  /** The kept paragraphs, each the sentences that passed, in order. */
  paragraphs: string[];
  /** The sentences dropped or marked, with why. */
  checks: CoverLetterCheck[];
}

/** Set on a letter by this check (its basis records which check it passed). */
export const LETTER_GROUNDING_VERSION = 1;

const LETTER_BLOCKING = new Set<GroundingIssue['code']>([...BLOCKING, 'PLACEHOLDER']);

interface Prepared {
  vocab: Vocab;
  evidence: Evidence;
  /** Words a name is checked against: the résumé's, the confirmed keywords', and the candidate's own. */
  known: Set<string>;
  /** Every number and date the résumé states, its facts included. */
  numbers: string;
  /** Where "N years of experience" must already be said: the summary and headline. */
  stated: string;
  /** The posting's text and words. */
  postingText: string;
  posting: Set<string>;
  /** The company as the posting gives it and without "Inc.", longest first. */
  companies: string[];
  /** The company's name is also a tool's ("Stripe"): only the company, not the tool, is stripped. */
  companyIsTool: boolean;
  /** The role's title as the posting gives it, shortened and with "Sr." spelled out, longest first. */
  titles: string[];
  confirmedKeywords: string[];
}

const START = '(?<![\\p{L}\\p{N}])';
const END = '(?![\\p{L}\\p{N}])';
const source = (text: string) => escapeRegex(text).replace(/\s+/g, '\\s+');
const wordPattern = (needle: string, flags = 'iu') => new RegExp(`${START}${source(needle)}${END}`, flags);
const has = (haystack: string, needle: string) => wordPattern(needle).test(haystack);

// Calendar words are dates, read by the number check with their year; not names.
const CALENDAR =
  'january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec monday tuesday wednesday thursday friday saturday sunday';

/** "Senior Backend Engineer (Payments)", "Senior Backend Engineer", and "Sr." as "Senior". */
function titleForms(title: string): string[] {
  const full = title.replace(/\s+/g, ' ').trim();
  const short = full.split(/\s*[(|,]\s*|\s+[-–—/]\s+/)[0]!.trim();
  const spelled = (text: string) => text.replace(/\bSr\.?(?=\s)/gi, 'Senior').replace(/\bJr\.?(?=\s)/gi, 'Junior');
  return [...new Set([full, short, spelled(full), spelled(short)])].filter((form) => form.length >= 2).sort((a, b) => b.length - a.length);
}

function prepare(ctx: LetterContext): Prepared {
  const { base, job, confirmedKeywords } = ctx;
  const vocab = buildVocab([
    ...flatSkills(base),
    ...(base.projects ?? []).flatMap((project) => project.keywords ?? []),
    ...ctx.jobTerms,
    ...confirmedKeywords,
  ]);
  const evidence = prepareEvidence(base, vocab, confirmedKeywords);
  const location = base.basics.location;
  // The candidate's own name and place, "I'm", "I'd", and calendar words: not names the résumé must have.
  const own = wordStems([base.basics.name, location?.city, location?.region, location?.countryCode, "I'm I'd I've I'll", CALENDAR].join(' '));
  const companies = [...new Set([job.company.trim(), companyName(job.company)])]
    .filter((name) => name.length >= 2)
    .sort((a, b) => b.length - a.length);
  return {
    vocab,
    evidence,
    known: new Set([...evidence.knownWords, ...own]),
    numbers: `${evidence.everything}\n${factsText(base)}`,
    stated: `${base.basics.summary ?? ''}\n${base.basics.label ?? ''}`,
    postingText: job.descriptionText,
    posting: wordStems(`${job.descriptionText}\n${job.title}\n${job.company}`),
    companies,
    companyIsTool: companies.some((name) => termsIn(name, vocab).length > 0),
    titles: titleForms(job.title),
    confirmedKeywords,
  };
}

/** A gap for the reader to fill in: "[Start Date]", "{company}", "<name>", "XX", "TBD". */
const PLACEHOLDER = /\[[^\]]*\]|\{[^}]*\}|<[^>]*>|(?<![\p{L}])(?:X{2,}|TBD|TK)(?![\p{L}])/u;

/** "I", "my", "me": the sentence is about the candidate. */
const FIRST_PERSON = /(?<![\p{L}'])(?:i|i'm|i've|i'd|i'll|my|me|mine|myself)(?![\p{L}'])/iu;
/** Wanting, hoping or liking: "I'd enjoy working on PayLink" claims nothing about the past. */
const NOT_A_CLAIM =
  /\b(?:would|will|could|might|shall|hope|hoping|look(?:ing)?\s+forward|excited|eager|keen|want|wish|love\s+to|like\s+to|plan|aim|admire|appeals?|drawn|interested|impressed|inspired|struck|i'd|i'll)\b/i;

/**
 * A tie to the company the résumé would have to show: "worked at Acme", "partnered with Acme",
 * "my time at Acme", "At Acme, I built", "a longtime Acme customer". "I look forward to working
 * at Acme" and "my next role at Acme" are hopes, not ties.
 */
function claimsTie(sentence: string, company: string): boolean {
  const name = `(?:the\\s+)?${source(company)}${END}`;
  return [
    `\\b(?:worked|served|interned|consulted|contracted|employed|partnered|collaborated|freelanced)\\s+(?:[\\p{L}-]+\\s+){0,2}?(?:at|for|with|by)\\s+${name}`,
    `\\b(?:was|were|been)\\s+(?:(?:a|an|the)\\s+(?:[\\p{L}-]+\\s+){0,2}?)?(?:at|with)\\s+${name}`,
    `\\bbeen\\s+(?:working|employed|consulting|interning|contracting)\\s+(?:at|for|with)\\s+${name}`,
    `\\b(?:my|our)\\s+(?:(?:previous|former|past|earlier|prior)\\s+)?(?:time|tenure|years?|months?|days|internship|stint)\\s+(?:at|with)\\s+${name}`,
    `\\b(?:my|our)\\s+(?:previous|former|past|earlier|prior)\\s+(?:role|work|job|position|employer)\\s+(?:(?:at|with)\\s+)?${name}`,
    `\\bwhile\\s+(?:I\\s+was\\s+)?at\\s+${name}`,
    `(?:^|[.!?;]\\s+)at\\s+${name}\\s*,?\\s+(?:I|we)\\b`,
    `\\b(?:used|integrated(?:\\s+with)?|built\\s+(?:on|with))\\s+${name}`,
    `\\b(?:a|an)\\s+(?:[\\p{L}-]+\\s+){0,2}?${source(company)}\\s+(?:customer|client|user|partner|employee|alum(?:nus|na|ni)?|intern|contractor|veteran)${END}`,
  ].some((pattern) => new RegExp(pattern, 'iu').test(sentence));
}

/** The role, where the letter applies for it: "the X role", "the position of X", "join Acme as an X". */
function rolePatterns(title: string): RegExp[] {
  const t = source(title);
  const noun = '(?:role|position|opening|job|post|vacancy|opportunity)';
  return [
    `${START}(?:(?:the|this|that|your|a|an)\\s+(?:next\\s+|new\\s+|open\\s+)?)?${t}\\s+${noun}${END}`,
    `${START}(?:(?:the|this|your)\\s+)?${noun}\\s+(?:of|as)\\s+(?:a\\s+|an\\s+)?${t}${END}`,
    `${START}(?:apply|applying|application|candidacy)\\s+(?:for|to)\\s+(?:(?:the|this|your)\\s+)?(?:a\\s+|an\\s+)?${t}${END}`,
    `${START}(?:your|the\\s+team's|the\\s+company's)\\s+(?:next|new)\\s+${t}${END}`,
    `${START}(?:join|joining)\\s+(?:[\\p{L}\\p{N}&.'-]+\\s+){0,5}?as\\s+(?:a\\s+|an\\s+|your\\s+|the\\s+)?(?:next\\s+|new\\s+)?${t}${END}`,
  ].map((pattern) => new RegExp(pattern, 'giu'));
}

/**
 * The sentence without the role where it is applied for, and without the company, which become
 * "it" ("Acme's CTO" reads "its CTO"). When the company is named like a tool, only where it is
 * the company ("join Stripe", "Stripe's mission"), so "built flows on Stripe" is still a claim.
 */
function withoutPosting(sentence: string, prepared: Prepared): string {
  let text = plain(sentence);
  for (const title of prepared.titles) for (const pattern of rolePatterns(title)) text = text.replace(pattern, ' ');
  for (const company of prepared.companies) {
    const name = source(company);
    text = text.replace(new RegExp(`${START}${name}['’]s${END}`, 'giu'), ' its ');
    const where = prepared.companyIsTool
      ? `(?:${START}(?:join|joining|at|to|for|about|into|towards?|from|of)\\s+${name}${END}|^\\s*${name}${END})`
      : `${START}${name}${END}`;
    text = text.replace(new RegExp(where, 'giu'), ' it ');
  }
  return text;
}

/** The sentence without the confirmed keywords, so "React 18" lends no 18 to a number check. */
function withoutKeywords(text: string, keywords: string[]): string {
  return keywords.reduce((out, keyword) => out.replace(wordPattern(keyword, 'giu'), ' '), text);
}

const TITLE_WORDS = '(?:lead|leader|manager|supervisor|director|head|vp|cto|ceo|cfo|coo|founder|co-founder|architect|recruiter)s?';
/**
 * Titles that belong to other people: "with your engineering director", "the CTO's post", "its
 * founder". Not "I was the tech lead" or "as the tech lead".
 */
const OTHERS_TITLE = new RegExp(
  `(?<![\\p{L}])(?:your|our|their|its|his|her|with|to|for|\\p{L}+'s|(?<!\\b(?:was|am|is|are|been|became|become|being|as|i'm)\\s+)(?:the|a|an))\\s+(?:[\\p{L}-]+\\s+){0,2}?${TITLE_WORDS}(?![\\p{L}])`,
  'giu',
);

/** Credentials, by family: a claimed one the résumé never names is dropped. */
const CREDENTIAL = /(?<![\p{L}])(certif\p{L}*|licen[cs]\p{L}*|clearance|accredit\p{L}*|chartered)(?![\p{L}])/giu;

function checkSentence(sentence: string, prepared: Prepared): { issues: GroundingIssue[]; confirmedTerms: string[] } {
  const issues: GroundingIssue[] = [];
  const confirmedTerms: string[] = [];
  const { evidence, vocab } = prepared;
  const asWritten = plain(sentence);
  const aboutMe = FIRST_PERSON.test(asWritten);
  const claim = aboutMe && !NOT_A_CLAIM.test(asWritten);

  const gap = PLACEHOLDER.exec(sentence);
  if (gap) issues.push({ code: 'PLACEHOLDER', term: gap[0], message: `has a gap to fill in, "${gap[0]}"` });

  for (const word of mixedScriptWords(sentence)) {
    if (!evidence.everythingPlain.includes(word)) {
      issues.push({ code: 'ODD_CHARACTERS', term: word, message: `writes "${word}" with look-alike letters` });
    }
  }

  for (const company of prepared.companies) {
    if (claimsTie(asWritten, company) && !has(evidence.everythingLower, norm(company))) {
      issues.push({ code: 'NEW_ENTITY', term: company, message: `says you have worked with ${company}, which your base résumé doesn't` });
      break;
    }
  }

  const text = withoutPosting(sentence, prepared);

  // Numbers and dates: as the résumé states them (or the posting, in a sentence about the company).
  // Years of experience: as the résumé's summary or headline does.
  const numberText = withoutKeywords(text, prepared.confirmedKeywords);
  const unsupported = findUnsupportedNumbers(numberText, aboutMe ? prepared.numbers : `${prepared.numbers}\n${prepared.postingText}`);
  for (const number of extractNumbers(numberText)) {
    if ((number.unit === 't:year' || number.unit === 't:month') && !unsupported.some((u) => u.raw === number.raw)) {
      if (aboutMe && findUnsupportedNumbers(number.raw, prepared.stated).length > 0) unsupported.push(number);
    }
  }
  for (const number of unsupported) {
    issues.push(
      number.year
        ? { code: 'NEW_DATE', term: number.raw, message: `adds the date ${number.raw}, which isn't in your base résumé` }
        : { code: 'NEW_NUMBER', term: number.raw, message: `adds the number ${number.raw}, which isn't in your base résumé` },
    );
  }

  // Tools and skills: the résumé's, or a confirmed keyword (marked as the user's).
  for (const key of termsIn(text, vocab)) {
    if (evidence.allTools.has(key)) continue;
    const term = displayOf(key, vocab);
    if (evidence.confirmedTools.has(key)) {
      const asTyped = prepared.confirmedKeywords.find((keyword) => termsIn(keyword, vocab, { evidence: true }).includes(key));
      confirmedTerms.push(asTyped ?? term);
      continue;
    }
    issues.push({ code: 'NEW_SKILL', term, message: `adds ${term}, which isn't in your base résumé` });
  }

  // Names: the résumé's are fine. The posting's are dropped when claimed, else marked. Any other is dropped.
  const names = newNames(text, prepared.known, vocab);
  for (const name of [...names.strong, ...names.weak]) {
    const fromPosting = prepared.posting.has(stem(name.toLowerCase()));
    issues.push(
      fromPosting && !claim
        ? { code: 'NEW_NAME', term: name, message: `mentions "${name}" from the posting, not your résumé` }
        : {
            code: 'NEW_TERM',
            term: name,
            message: fromPosting ? `claims "${name}" from the posting, which isn't in your base résumé` : `adds "${name}", which isn't in your base résumé`,
          },
    );
  }

  for (const degree of degreesIn(text)) {
    if (!evidence.degrees.has(degree)) {
      issues.push({ code: 'NEW_ENTITY', term: degree, message: `adds a ${degree}, which isn't in your base résumé` });
    }
  }
  if (claim) {
    for (const match of text.matchAll(CREDENTIAL)) {
      const family = match[1]!.toLowerCase().slice(0, 6).replace(/c$/, 's');
      if (!new RegExp(`(?<![\\p{L}])${family.replace('licens', 'licen[cs]')}`, 'u').test(evidence.everythingLower)) {
        issues.push({ code: 'NEW_ENTITY', term: match[1], message: `says you're ${match[1]!.toLowerCase()}, which your base résumé doesn't` });
        break;
      }
    }
  }

  // Titles the candidate claims: only the résumé's own (its job titles, headline and summary).
  const titles = titleText(text).replace(OTHERS_TITLE, ' ');
  const claimed = new Set<string>();
  for (const found of titleClaims(titles, true)) if (!has(evidence.titles, found)) claimed.add(found);
  for (const title of heldTitles(titles).keys()) if (!has(evidence.titles, title)) claimed.add(title);
  for (const found of claimed) {
    issues.push({ code: 'NEW_SENIORITY', term: found, message: `claims "${found}", a title your base résumé doesn't have` });
  }

  // Leading or owning work the résumé never says you did: kept, and marked.
  const lower = norm(text);
  for (const verb of LEADERSHIP) {
    const found = verb.exec(lower);
    if (found && !verb.test(evidence.everythingLower)) {
      issues.push({ code: 'LEADERSHIP_CLAIM', term: found[0], message: `says "${found[0]}", which your base résumé doesn't` });
    }
  }

  return { issues, confirmedTerms: [...new Set(confirmedTerms)] };
}

// Words a sentence can end on with a period that isn't its end: "e.g.", "Dr.", "Inc.".
const ABBREVIATIONS = new Set(
  'e.g i.e etc vs mr mrs ms dr prof inc ltd co corp jr sr st no approx dept est u.s u.k a.m p.m'.split(' '),
);

/** A paragraph's sentences, at a stop followed by a capital or digit (not "e.g.", "U.S.", "3.5"). */
export function splitSentences(paragraph: string): string[] {
  const text = paragraph.replace(/\s+/g, ' ').trim();
  const sentences: string[] = [];
  let start = 0;
  for (const match of text.matchAll(/[.!?]+["'”’)\]]*(?=\s+["'“‘(]?[\p{Lu}\p{N}])/gu)) {
    const end = match.index + match[0].length;
    if (match[0].startsWith('.')) {
      const word = (/(\S+)$/.exec(text.slice(start, match.index))?.[1] ?? '').toLowerCase().replace(/^[("'“‘]+/, '');
      // An abbreviation or an initial ("J. Smith") doesn't end a sentence.
      if (ABBREVIATIONS.has(word) || /^\p{L}$/u.test(word)) continue;
    }
    sentences.push(text.slice(start, end).trim());
    start = end;
  }
  if (start < text.length) sentences.push(text.slice(start).trim());
  return sentences.filter(Boolean);
}

const GREETING = /^(?:dear|hello|hi|greetings|to whom it may concern)\b/i;
/** "Dear Hiring Manager," at the start of the letter, up to its comma or colon. */
const GREETING_PREFIX = /^(?:dear|hello|hi|greetings|to whom it may concern)\b[^,:!\n]{0,60}[,:!]\s*/i;
const SIGN_OFF =
  /^(?:sincerely|best|best regards|kind regards|warm regards|warmest regards|regards|yours (?:truly|sincerely|faithfully)|respectfully|with gratitude|thank you|thanks|cheers)\s*[,.!]?$/i;

/**
 * The model's paragraphs as the letter's body: split at blank lines, without a greeting or a
 * sign-off (the PDF adds its own), each on one line.
 */
function bodyParagraphs(raw: string[]): string[] {
  const blocks = raw.flatMap((paragraph) => paragraph.replace(/\r\n?/g, '\n').split(/\n\s*\n/)).map((block) => block.trim()).filter(Boolean);
  if (blocks.length > 0) {
    const greeting = GREETING_PREFIX.exec(blocks[0]!);
    const [firstLine, ...rest] = blocks[0]!.split('\n');
    if (greeting) {
      const remainder = blocks[0]!.slice(greeting[0].length).trim();
      if (remainder) blocks[0] = remainder;
      else blocks.shift();
    } else if (GREETING.test(firstLine!.trim()) && firstLine!.trim().split(/\s+/).length <= 10) {
      const remainder = rest.join('\n').trim();
      if (remainder) blocks[0] = remainder;
      else blocks.shift();
    }
  }
  const signOff = blocks.findIndex((block) => SIGN_OFF.test(block.split('\n')[0]!.trim()));
  return (signOff === -1 ? blocks : blocks.slice(0, signOff)).map((block) => block.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** The model's letter, checked a sentence at a time: what is kept, and what was dropped or marked. */
export function groundLetter(raw: string[], ctx: LetterContext): GroundedLetter {
  const prepared = prepare(ctx);
  const paragraphs: string[] = [];
  const checks: CoverLetterCheck[] = [];
  for (const paragraph of bodyParagraphs(raw)) {
    const kept: string[] = [];
    const found: Array<Omit<CoverLetterCheck, 'paragraph'>> = [];
    for (const sentence of splitSentences(paragraph)) {
      const { issues, confirmedTerms } = checkSentence(sentence, prepared);
      const reason = issues.find((issue) => LETTER_BLOCKING.has(issue.code))?.message;
      if (reason) {
        found.push({ text: sentence, dropped: true, dropReason: reason, issues });
        continue;
      }
      kept.push(sentence);
      if (issues.length > 0 || confirmedTerms.length > 0) {
        found.push({ text: sentence, dropped: false, issues, ...(confirmedTerms.length > 0 ? { confirmedTerms } : {}) });
      }
    }
    const index = kept.length > 0 ? paragraphs.length : null;
    if (kept.length > 0) paragraphs.push(kept.join(' '));
    for (const check of found) checks.push({ paragraph: index, ...check });
  }
  return { paragraphs, checks };
}

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
  /**
   * Words a name is checked against: the résumé's and the candidate's own. A confirmed keyword
   * counts only as its whole phrase ("Google Cloud" makes "Google Cloud" known, not "Google").
   */
  known: Set<string>;
  /** The posting's names: words it writes with a capital mid-sentence that the résumé lacks. */
  postingNames: Set<string>;
  /** The candidate's own email address and links, lower case: the only ones a letter may give. */
  contacts: string;
  /** Every number and date the résumé states, its facts included. */
  numbers: string;
  /** Where "N years of experience" must already be said: the summary and headline. */
  stated: string;
  /** The posting's text and words. */
  postingText: string;
  posting: Set<string>;
  /** The candidate's name, for a sign-off the model wrote. */
  name: string;
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

/**
 * Words that start sentences, or follow "worked at", without naming anything: a sentence's first
 * word that isn't one of these, nor in the résumé or the posting, is read as a name.
 */
const COMMON = new Set(
  (
    'a about above across additionally after again against all along alongside already also although always among an and ' +
    'another any are around as at be because been before being below beside besides between beyond both but by ' +
    'can combined could currently day during each earlier early either even every few finally first five following ' +
    'for four from further furthermore given good great having he hence her here his how however i if in indeed ' +
    'instead into is it its just key last lastly later like likewise many meanwhile more moreover most much my ' +
    'next no not notably now of on once one only or other otherwise our outside over overall please previously ' +
    'recently right same second several she similarly since six so some specifically still such ten than thank ' +
    'thanks that the their them then there therefore these they third this those three through throughout thus ' +
    'to today together toward towards two ultimately under unlike until upon us we well what when where whether ' +
    'which while who why with within without working yes yet you your ' +
    'forefront heart center centre core intersection helm start end top scale risk home ease work school ' +
    'university college length best scale night times'
  ).split(' '),
);

/** Number words, which name nothing. */
const NUMBER_WORDS = /^(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|hundred|thousand|million|billion|several|many|few)$/i;

const NAME_TOKEN = /[\p{L}][\p{L}\p{N}+#]*(?:['.-][\p{L}\p{N}+#]+)*/gu;

/** Words the posting writes with a capital mid-sentence that the résumé lacks: "Temporal", "PayLink". */
function postingNamesOf(job: LetterContext['job'], known: Set<string>): Set<string> {
  const names = new Set<string>();
  const generic = new Set<string>();
  const companyAndTitle = wordStems(`${job.company}\n${job.title}`);
  for (const sentence of plain(job.descriptionText).split(/(?<=[.!?:;])\s+|\n+/)) {
    [...sentence.matchAll(NAME_TOKEN)].forEach((match, i) => {
      const word = match[0];
      const lower = word.toLowerCase();
      if (word === lower) generic.add(lower);
      else if (i > 0 && /^\p{Lu}/u.test(word) && !COMMON.has(lower) && !known.has(stem(lower)) && !companyAndTitle.has(stem(lower))) {
        names.add(lower);
      }
    });
  }
  for (const word of generic) names.delete(word);
  return names;
}

/** Email addresses and links ("https://…", "www.…", "github.com/…"), lower case and without trailing stops. */
function linksIn(sentence: string): string[] {
  const emails = [...sentence.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((match) => match[0]);
  const rest = emails.reduce((out, email) => out.replace(email, ' '), sentence);
  const urls = [
    ...rest.matchAll(/https?:\/\/[^\s)]+|www\.[^\s)]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|io|dev|ai|co|edu|gov|me|app)\b(?:\/[^\s)]*)?/g),
  ].map((match) => match[0]);
  return [...emails, ...urls].map((link) => link.replace(/[.,;:!?]+$/, '').toLowerCase());
}

/** Where a claim names an employer in any case: "worked at google", "was at stripe", "joined netflix". */
const EMPLOYER = [
  /\b(?:worked|working|interned|served|consulted|contracted|employed|freelanced|was|were|been|stayed)\s+(?:at|for)\s+(?:the\s+)?([\p{L}][\p{L}\p{N}&'-]*)/giu,
  /\bspent\s+(?:[\p{L}\p{N}-]+\s+){1,3}?at\s+(?:the\s+)?([\p{L}][\p{L}\p{N}&'-]*)/giu,
  /\bjoined\s+(?:the\s+)?([\p{L}][\p{L}\p{N}&'-]*)/giu,
];

/**
 * Where the letter may name the company in a sentence about the candidate: applying to it, the
 * role at it, bringing something to it, or the company doing something ("Acme builds…").
 */
function namedOnlyToApply(sentence: string, company: string): boolean {
  const name = `(?:the\\s+)?${source(company)}${END}`;
  const allowed = [
    new RegExp(`\\b(?:apply|applying|application|candidacy)\\s+(?:[\\p{L}\\p{N}&.'()-]+\\s+){0,8}?(?:at|to|with)\\s+${name}`, 'giu'),
    new RegExp(`(?<!\\b(?:my|our)\\s+(?:[\\p{L}-]+\\s+)?)\\b(?:role|position|opening|job|vacancy|opportunity)\\s+(?:at|with)\\s+${name}`, 'giu'),
    new RegExp(`\\b(?:bring|contribute|add|offer)\\s+(?:[\\p{L}\\p{N}'-]+\\s+){0,6}?to\\s+${name}`, 'giu'),
    new RegExp(`^\\s*${source(company)}(?:['\u2019]s\\s+[\\p{L}-]+)?\\s+(?!was\\b|has\\b|hired\\b)\\p{Ll}+s\\b`, 'gu'),
  ];
  const rest = allowed.reduce((out, pattern) => out.replace(pattern, ' '), sentence);
  return !wordPattern(company).test(rest);
}

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
  const resumeWords = prepareEvidence(base, vocab, []).knownWords;
  const location = base.basics.location;
  // The candidate's own name and place, "I'm", "I'd", and calendar words: not names the résumé must have.
  const own = wordStems([base.basics.name, location?.city, location?.region, location?.countryCode, "I'm I'd I've I'll", CALENDAR].join(' '));
  const companies = [...new Set([job.company.trim(), companyName(job.company)])]
    .filter((name) => name.length >= 2)
    .sort((a, b) => b.length - a.length);
  return {
    vocab,
    evidence,
    known: new Set([...resumeWords, ...own]),
    postingNames: postingNamesOf(job, new Set([...resumeWords, ...own])),
    contacts: [base.basics.email, base.basics.url, ...(base.basics.profiles ?? []).map((profile) => profile.url), evidence.everything]
      .filter((part): part is string => typeof part === 'string')
      .join('\n')
      .toLowerCase(),
    name: base.basics.name?.trim() ?? '',
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

  for (const link of linksIn(asWritten)) {
    if (!prepared.contacts.includes(link)) {
      issues.push({ code: 'NEW_ENTITY', term: link, message: `adds "${link}", which isn't in your base résumé` });
    }
  }

  // Ties to the company. In a claim about the candidate, any mention fails closed: only applying
  // to it, the role at it and bringing something to it are not claims.
  for (const company of prepared.companies) {
    if (has(evidence.everythingLower, norm(company))) continue;
    if (claimsTie(asWritten, company)) {
      issues.push({ code: 'NEW_ENTITY', term: company, message: `says you have worked with ${company}, which your base résumé doesn't` });
      break;
    }
    if (claim && wordPattern(company).test(asWritten) && !namedOnlyToApply(asWritten, company)) {
      issues.push({ code: 'NEW_ENTITY', term: company, message: `ties you to ${company}, which your base résumé doesn't` });
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

  // Names: the résumé's are fine. The posting's are dropped when claimed, else marked. Any other is
  // dropped. A confirmed keyword is known only as its whole phrase, so it is taken out first.
  const nameText = withoutKeywords(text, prepared.confirmedKeywords);
  const names = newNames(nameText, prepared.known, vocab);
  const reported = new Set<string>();
  const report = (name: string) => {
    if (reported.has(name.toLowerCase())) return;
    reported.add(name.toLowerCase());
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
  };
  for (const name of [...names.strong, ...names.weak]) report(name);
  // The first word too: "Google trained me", unless it's a common word or the résumé's or posting's.
  const first = /^[\s"'([]*([\p{L}][\p{L}\p{N}+#]*(?:['.-][\p{L}\p{N}+#]+)*)/u.exec(nameText)?.[1];
  if (first && /^\p{Lu}/u.test(first) && first.length >= 2) {
    const lower = first.toLowerCase();
    const isWord =
      COMMON.has(lower) ||
      NUMBER_WORDS.test(lower) ||
      /(?:ing|ly)$/.test(lower) ||
      prepared.known.has(stem(lower)) ||
      prepared.posting.has(stem(lower)) ||
      termsIn(first, vocab).length > 0 ||
      degreesIn(first).length > 0;
    if (!isWord) report(first);
  }
  if (claim) {
    // An employer in lower case ("worked at google"), and the posting's names in any case.
    for (const pattern of EMPLOYER) {
      for (const match of nameText.matchAll(pattern)) {
        const word = match[1]!;
        const lower = word.toLowerCase();
        if (COMMON.has(lower) || NUMBER_WORDS.test(lower) || prepared.known.has(stem(lower)) || termsIn(word, vocab).length > 0) continue;
        report(word);
      }
    }
    for (const match of nameText.matchAll(NAME_TOKEN)) {
      if (prepared.postingNames.has(match[0].toLowerCase())) report(match[0]);
    }
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
const SIGN_OFF_PHRASE =
  /^(?:sincerely|best regards|best wishes|best|kind regards|warmest regards|warm regards|regards|yours (?:truly|sincerely|faithfully)|respectfully|with gratitude|thank you|thanks|cheers)/i;
/** Up to four capitalised words: the name after "Best regards," on the same line. */
const SIGNED_NAME = /^[\p{Lu}][\p{L}.'-]*(?:\s+[\p{Lu}][\p{L}.'-]*){0,3}$/u;

/** "Sincerely,", "Best regards, Jordan Lee": a sign-off line. "Thank you for your time." is not. */
function isSignOff(line: string): boolean {
  const phrase = SIGN_OFF_PHRASE.exec(line.trim());
  if (!phrase) return false;
  const rest = line.trim().slice(phrase[0].length).trim();
  if (/^[,.!]?$/.test(rest)) return true;
  return rest.startsWith(',') && SIGNED_NAME.test(rest.slice(1).trim());
}

/**
 * The model's paragraphs as the letter's body: split at blank lines, without a greeting or a
 * sign-off (the PDF adds its own), each on one line.
 */
function bodyParagraphs(raw: string[], name: string): string[] {
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
  // A sign-off ends the letter: looked for line by line in the last two blocks, with at most a
  // name after it, so a "Thank you!" mid-letter doesn't cut what follows.
  for (let b = Math.max(0, blocks.length - 2); b < blocks.length; b += 1) {
    const lines = blocks[b]!.split('\n');
    const at = lines.findIndex(isSignOff);
    if (at === -1) continue;
    // Only a name may follow a sign-off: "Thank you!" with the letter after it is the letter.
    const after = [...lines.slice(at + 1), ...blocks.slice(b + 1)].join(' ').replace(/\s+/g, ' ').trim();
    if (after && !SIGNED_NAME.test(after)) continue;
    const before = lines.slice(0, at).join('\n').trim();
    blocks.splice(b, blocks.length - b, ...(before ? [before] : []));
    break;
  }
  // The candidate's name alone at the end: the PDF signs the letter.
  if (name && blocks.length > 0 && norm(blocks[blocks.length - 1]!) === norm(name)) blocks.pop();
  return blocks.map((block) => block.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** The model's letter, checked a sentence at a time: what is kept, and what was dropped or marked. */
export function groundLetter(raw: string[], ctx: LetterContext): GroundedLetter {
  const prepared = prepare(ctx);
  const paragraphs: string[] = [];
  const checks: CoverLetterCheck[] = [];
  for (const paragraph of bodyParagraphs(raw, prepared.name)) {
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

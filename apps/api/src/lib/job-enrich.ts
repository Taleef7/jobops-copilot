import { createHash } from 'node:crypto';
import type { JobSeniority } from '@/types';

export interface ParsedSalary {
  min: number | null;
  max: number | null;
  currency: string;
}

const HOURS_PER_YEAR = 2080;
const MIN_REASONABLE_ANNUAL = 10000;
const MAX_REASONABLE_ANNUAL = 2000000;

function resolveCurrency(text: string): string {
  if (text.includes('£') || /\bGBP\b/i.test(text)) return 'GBP';
  if (text.includes('€') || /\bEUR\b/i.test(text)) return 'EUR';
  if (/\bCAD\b/i.test(text)) return 'CAD';
  return 'USD';
}

function parseNumber(raw: string, isK: boolean, isHourly: boolean): number {
  let val = parseFloat(raw.replace(/,/g, ''));
  if (isK) {
    val *= 1000;
  } else if (isHourly) {
    val *= HOURS_PER_YEAR;
  }
  return Math.round(val);
}

function isReasonable(min: number | null, max: number | null): boolean {
  if (min == null && max == null) return false;
  if (min != null && (min < MIN_REASONABLE_ANNUAL || min > MAX_REASONABLE_ANNUAL)) return false;
  if (max != null && (max < MIN_REASONABLE_ANNUAL || max > MAX_REASONABLE_ANNUAL)) return false;
  if (min != null && max != null && min > max) return false;
  return true;
}

type SalaryMatch = ParsedSalary & { hourly: boolean };

/** The salary the store saves for a description: an hourly rate is made annual (x2080). */
export function parseSalaryFromText(text: string): ParsedSalary | null {
  const match = matchSalary(text);
  return match ? { min: match.min, max: match.max, currency: match.currency } : null;
}

// Currencies the parser reads as one it knows: another dollar ("$120,000 CAD", "C$") is
// read as USD, so the review can't trust the currency when one of these appears.
const OTHER_CURRENCY = /\b(?:CAD|AUD|NZD|SGD|HKD|INR|JPY|CHF|SEK|NOK|DKK|MXN|BRL|ZAR|PLN)\b|\b(?:C|CA|A|AU|NZ|S|HK)\$/;
// A sign that the posting talks about pay, whether or not a figure could be read.
const SALARY_SIGNS = /[$£€]\s?\d|\b(?:salary|salaries|compensation|pay range|pay rate|base pay|hourly rate|per hour|per annum|OTE)\b/i;

/**
 * The salary for the Add job review (#355), as the posting states it: an annual figure in a
 * currency the parser is sure of. Undefined (unknown) when the store would convert it (an
 * hourly rate), when the currency could be another one, or when the posting talks about pay
 * in a way the parser can't read. Null only when the posting shows no sign of a salary.
 */
export function readSalaryForReview(text: string): ParsedSalary | null | undefined {
  const match = matchSalary(text);
  if (match) {
    if (match.hourly || OTHER_CURRENCY.test(text)) return undefined;
    return { min: match.min, max: match.max, currency: match.currency };
  }
  return SALARY_SIGNS.test(text) ? undefined : null;
}

function matchSalary(text: string): SalaryMatch | null {
  if (!text || typeof text !== 'string') return null;

  // Mask 401(k) references so they aren't parsed as a $401k salary.
  // Pasted text reaches this (#355), so the input is shaped first and every repeat below is
  // bounded: one space for each run of whitespace, and no digit run longer than any salary.
  // Unbounded runs made these regexes quadratic (40k digits took 16 s).
  const cleaned = text
    .replace(/401\s*\(?k\)?/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\d{13,}/g, ' ');
  const currency = resolveCurrency(cleaned);

  // 1. Hourly rate: e.g. "$45/hr contract" or "$40 - $60 / hour"
  const hourlyRangeMatches = cleaned.matchAll(
    /(?:\$|£|€|USD|GBP|EUR)?\s*(\d{1,12}(?:\.\d{1,12})?)\s*(?:-|–|—|to)\s*(?:\$|£|€|USD|GBP|EUR)?\s*(\d{1,12}(?:\.\d{1,12})?)\s*(?:\/|\bper\s+)(?:hr|hour|hourly)\b/gi,
  );
  for (const m of hourlyRangeMatches) {
    const min = parseNumber(m[1]!, false, true);
    const max = parseNumber(m[2]!, false, true);
    if (isReasonable(min, max)) {
      return { min, max, currency, hourly: true };
    }
  }

  const singleHourlyMatches = cleaned.matchAll(
    /(?:\$|£|€|USD|GBP|EUR)?\s*(\d{1,12}(?:\.\d{1,12})?)\s*(?:\/|\bper\s+)(?:hr|hour|hourly)\b/gi,
  );
  for (const m of singleHourlyMatches) {
    const rate = parseNumber(m[1]!, false, true);
    if (isReasonable(rate, rate)) {
      return { min: rate, max: rate, currency, hourly: true };
    }
  }

  // 2. Annual range: e.g. "$120,000 - $150,000", "$120k–$150K", "120,000 to 150,000 USD"
  // Prioritize matches with currency symbols or salary keywords, iterating all matches.
  const rangeRegex =
    /(?:(\$|£|€|USD|GBP|EUR)\s*)?(\d{1,12}(?:,\d{3}){0,4}(?:\.\d{1,12})?)\s*(k)?\s*(?:-|–|—|to)\s*(?:(\$|£|€|USD|GBP|EUR)\s*)?(\d{1,12}(?:,\d{3}){0,4}(?:\.\d{1,12})?)\s*(k)?\s*(USD|GBP|EUR)?/gi;

  for (const m of cleaned.matchAll(rangeRegex)) {
    const curr1 = m[1];
    const raw1 = m[2]!;
    const k1 = Boolean(m[3]);
    const curr2 = m[4];
    const raw2 = m[5]!;
    const k2 = Boolean(m[6]);
    const curr3 = m[7];

    const hasCurrency = Boolean(curr1 || curr2 || curr3);
    const isK = k1 || k2;

    // When no currency is attached, require salary context in nearby prefix or suffix,
    // even for k-suffixed ranges (e.g. "serves 10k-20k users daily").
    if (!hasCurrency) {
      const matchIndex = m.index ?? 0;
      const matchLength = m[0].length;
      const prefix = cleaned.slice(Math.max(0, matchIndex - 30), matchIndex).toLowerCase();
      const suffix = cleaned.slice(matchIndex + matchLength, matchIndex + matchLength + 30).toLowerCase();
      if (
        !/\b(salary|pay|compensation|comp|rate)\b/.test(prefix) &&
        !/\b(salary|pay|compensation|comp|rate)\b/.test(suffix)
      ) {
        continue;
      }
    }

    const min = parseNumber(raw1, isK, false);
    const max = parseNumber(raw2, isK, false);

    // Only scale bare numbers < 1000 if they have explicit 'k'
    if (!isK && (min < 1000 || max < 1000)) {
      continue;
    }

    if (isReasonable(min, max)) {
      const matchCurr = curr1 || curr2 || curr3;
      const effectiveCurr = matchCurr ? resolveCurrency(matchCurr) : currency;
      return { min, max, currency: effectiveCurr, hourly: false };
    }
  }

  // 3. "up to" as max-only: e.g. "up to $95,000" or "up to $120k"
  const upToMatches = cleaned.matchAll(
    /\b(?:up\s+to|max(?:imum)?)\s*(?:(\$|£|€|USD|GBP|EUR)\s*)?(\d{1,12}(?:,\d{3}){0,4}(?:\.\d{1,12})?)\s*(k)?\b/gi,
  );
  for (const m of upToMatches) {
    const currSym = m[1];
    const isK = Boolean(m[3]);
    let val = parseNumber(m[2]!, isK, false);
    if (!isK && val < 1000 && currSym) {
      val *= 1000;
    }
    if (isReasonable(null, val)) {
      const effectiveCurr = currSym ? resolveCurrency(currSym) : currency;
      return { min: null, max: val, currency: effectiveCurr, hourly: false };
    }
  }

  // 4. "from" / "starting at" as min-only: e.g. "starting at $80,000"
  const fromMatches = cleaned.matchAll(
    /\b(?:starting\s+at|from|min(?:imum)?)\s*(?:(\$|£|€|USD|GBP|EUR)\s*)?(\d{1,12}(?:,\d{3}){0,4}(?:\.\d{1,12})?)\s*(k)?\b/gi,
  );
  for (const m of fromMatches) {
    const currSym = m[1];
    const isK = Boolean(m[3]);
    let val = parseNumber(m[2]!, isK, false);
    if (!isK && val < 1000 && currSym) {
      val *= 1000;
    }
    if (isReasonable(val, null)) {
      const effectiveCurr = currSym ? resolveCurrency(currSym) : currency;
      return { min: val, max: null, currency: effectiveCurr, hourly: false };
    }
  }

  return null;
}

function detectSeniority(text: string): JobSeniority {
  const lower = text.toLowerCase();
  if (/\b(lead|staff|principal|director|head\s+of|architect)\b/i.test(lower)) {
    return 'lead';
  }
  if (/\b(senior|sr\.?|senior-level)\b/i.test(lower)) {
    return 'senior';
  }
  if (/\b(junior|jr\.?|entry|intern|associate)\b/i.test(lower)) {
    return 'junior';
  }
  if (/\b(mid-level|mid|intermediate)\b/i.test(lower)) {
    return 'mid';
  }
  return 'unknown';
}

export function parseSeniority(title: string, descriptionText: string): JobSeniority {
  const fromTitle = detectSeniority(title || '');
  if (fromTitle !== 'unknown') {
    return fromTitle;
  }
  return detectSeniority(descriptionText || '');
}

export function computeContentHash(job: {
  company: string;
  title: string;
  descriptionText: string;
}): string {
  const payload = `${(job.company || '').trim().toLowerCase()}|${(job.title || '').trim().toLowerCase()}|${(job.descriptionText || '').trim()}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

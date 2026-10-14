import { plain } from './text';

/**
 * Numbers in a line, so a tailored line can't add or change a metric (#351, SPEC rule 6).
 * A number is its value with any multiplier applied, and its unit: "%", "cur" (a currency
 * sign), "x", or none. Identifiers that contain a digit (p95, EC2, S3, Q3, OAuth2) are not
 * numbers: a letter right before the digits rules them out.
 */
export interface FoundNumber {
  value: number;
  unit: '%' | 'cur' | 'x' | '';
  /** A plain four-digit year from 1900 to 2099. */
  year: boolean;
  /** As written, for the message ("60%", "three"). */
  raw: string;
}

const NUMBER =
  /(?<![\p{L}\p{N}.])([$€£¥])?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s?(%|percent\b|k\b|mm?\b|bn?\b|million\b|billion\b|thousand\b|x\b|×))?/giu;

const WORDS: Record<string, number> = {
  zero: 0, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, dozen: 12,
};
// "one" is left out: "one of the first" is not a count.
const NUMBER_WORD = new RegExp(`\\b(${Object.keys(WORDS).join('|')})\\b`, 'gi');

const MULTIPLIER: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9,
};

export function extractNumbers(text: string): FoundNumber[] {
  const source = plain(text);
  const found: Array<FoundNumber & { at: number }> = [];
  for (const match of source.matchAll(NUMBER)) {
    const [whole, currency, digits = '', decimals, suffix] = match;
    const unitWord = suffix?.toLowerCase();
    let value = Number(`${digits.replace(/,/g, '')}${decimals ? `.${decimals}` : ''}`);
    let unit: FoundNumber['unit'] = currency ? 'cur' : '';
    if (unitWord === '%' || unitWord === 'percent') unit = '%';
    else if (unitWord === 'x' || unitWord === '×') unit = 'x';
    else if (unitWord) value *= MULTIPLIER[unitWord] ?? 1;
    const year = !currency && !decimals && !unitWord && /^(19|20)\d\d$/.test(digits);
    found.push({ value, unit, year, raw: whole.trim(), at: match.index ?? 0 });
  }
  for (const match of source.matchAll(NUMBER_WORD)) {
    const word = match[1]!;
    found.push({ value: WORDS[word.toLowerCase()]!, unit: '', year: false, raw: word, at: match.index ?? 0 });
  }
  return found.sort((a, b) => a.at - b.at).map(({ value, unit, year, raw }) => ({ value, unit, year, raw }));
}

const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));

/**
 * The numbers in `text` that `evidence` doesn't state: the same value is needed, with the
 * same unit, or with none (dropping "%" from "40%" claims no more).
 */
export function findUnsupportedNumbers(text: string, evidence: string): FoundNumber[] {
  const known = extractNumbers(evidence);
  return extractNumbers(text).filter(
    (number) => !known.some((k) => same(k.value, number.value) && (number.unit === '' || k.unit === number.unit)),
  );
}

export function unsupportedNumbers(text: string, evidence: string): string[] {
  return findUnsupportedNumbers(text, evidence).map((number) => number.raw);
}

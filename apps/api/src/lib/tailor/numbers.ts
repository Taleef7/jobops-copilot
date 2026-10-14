import { plain } from './text';

/**
 * Numbers in a line, so a tailored line can't add or change a metric (#351, SPEC rule 6).
 *
 * A number is its value with any multiplier applied, and its unit: "%", "cur" (a currency
 * sign), "x", a unit of time ("t:year", "t:hour", ...), or none. "~" marks a rough count
 * ("thousands of"), whose value is the magnitude. Identifiers that contain a digit (p95, EC2,
 * S3, Q3, OAuth2) are not numbers: a letter right before the digits rules them out.
 */
export interface FoundNumber {
  value: number;
  unit: string;
  /** A plain four-digit year from 1900 to 2099. */
  year: boolean;
  /** As written, for the message ("60%", "three"). */
  raw: string;
  /** Written as an ordinal ("95th"). */
  ordinal?: boolean;
}

const TIME: Array<[RegExp, string]> = [
  [/^(years?|yrs?)$/i, 'year'],
  [/^(months?|mos?)$/i, 'month'],
  [/^(weeks?|wks?)$/i, 'week'],
  [/^days?$/i, 'day'],
  [/^(hours?|hrs?)$/i, 'hour'],
  [/^(minutes?|mins?)$/i, 'minute'],
  [/^(seconds?|secs?)$/i, 'second'],
  [/^(ms|milliseconds?)$/i, 'ms'],
];
const TIME_WORDS = 'years?|yrs?|months?|mos?|weeks?|wks?|days?|hours?|hrs?|minutes?|mins?|seconds?|secs?|milliseconds?|ms';

const NUMBER = new RegExp(
  String.raw`(?<![\p{L}\p{N}.])([$€£¥])?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\+?` +
    String.raw`(?:[\s-]?(${TIME_WORDS})\b|\s?(%|percent\b|k\b|mm?\b|bn?\b|million\b|billion\b|thousand\b|x\b|×))?`,
  'giu',
);
// "by60%": a percentage glued to a word.
const GLUED_PERCENT = /(?<=\p{L})(\d+(?:\.\d+)?)\s?%/gu;
// "x3 faster".
const TIMES_PREFIX = /(?<![\p{L}\p{N}])x(\d+(?:\.\d+)?)(?![\p{L}\p{N}])/giu;

const SMALL: Record<string, number> = {
  zero: 0, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, dozen: 12,
};
const MAGNITUDE: Record<string, number> = { hundred: 1e2, thousand: 1e3, million: 1e6, billion: 1e9 };
// "two thousand", "a million". "one" and "a" count only before a magnitude: "one of the first"
// is not a count.
const WORD_TIMES_MAGNITUDE = new RegExp(
  String.raw`\b(a|an|one|${Object.keys(SMALL).join('|')})\s+(hundred|thousand|million|billion)\b`,
  'gi',
);
const SMALL_WORD = new RegExp(String.raw`\b(${Object.keys(SMALL).join('|')})\b`, 'gi');
// "thousands of": a rough count, supported by a number of that size.
const ROUGH: Record<string, [number, number]> = {
  dozens: [24, 200],
  hundreds: [200, 1e3],
  thousands: [2e3, 1e6],
  millions: [2e6, 1e9],
  billions: [2e9, Infinity],
};
const ROUGH_WORD = /\b(dozens|hundreds|thousands|millions|billions)\b/gi;
// "doubled", "tripling", "halved".
const MULTIPLIER_VERB = /\b(doubl|tripl|quadrupl|halv)(?:e|ed|es|ing)\b/gi;
const MULTIPLIED: Record<string, [number, string]> = { doubl: [2, 'x'], tripl: [3, 'x'], quadrupl: [4, 'x'], halv: [50, '%'] };

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

/** ".5M" reads as "0.5M". */
const leadingPoint = (text: string) => text.replace(/(?<![\p{N}])\.(\d)/gu, '0.$1');

export function extractNumbers(text: string): FoundNumber[] {
  const source = leadingPoint(plain(text));
  const found: Array<FoundNumber & { at: number }> = [];
  const taken: Array<[number, number]> = [];
  const isTaken = (at: number) => taken.some(([start, end]) => at >= start && at < end);
  const add = (number: FoundNumber, at: number, length: number) => {
    found.push({ ...number, at });
    taken.push([at, at + length]);
  };

  for (const match of source.matchAll(NUMBER)) {
    const [whole, currency, digits = '', decimals, timeWord, suffix] = match;
    const unitWord = suffix?.toLowerCase();
    let value = Number(`${digits.replace(/,/g, '')}${decimals ? `.${decimals}` : ''}`);
    let unit = currency ? 'cur' : '';
    if (timeWord) unit = `t:${TIME.find(([pattern]) => pattern.test(timeWord))![1]}`;
    else if (unitWord === '%' || unitWord === 'percent') unit = '%';
    else if (unitWord === 'x' || unitWord === '×') unit = 'x';
    else if (unitWord) value *= SCALE[unitWord] ?? 1;
    const year = !currency && !decimals && !unitWord && !timeWord && /^(19|20)\d\d$/.test(digits);
    const ordinal = /^(st|nd|rd|th)\b/i.test(source.slice((match.index ?? 0) + whole.length));
    add({ value, unit, year, raw: whole.trim(), ordinal }, match.index ?? 0, whole.length);
  }
  for (const match of source.matchAll(GLUED_PERCENT)) {
    add({ value: Number(match[1]), unit: '%', year: false, raw: match[0] }, match.index ?? 0, match[0].length);
  }
  for (const match of source.matchAll(TIMES_PREFIX)) {
    add({ value: Number(match[1]), unit: 'x', year: false, raw: match[0] }, match.index ?? 0, match[0].length);
  }
  for (const match of source.matchAll(WORD_TIMES_MAGNITUDE)) {
    const word = match[1]!.toLowerCase();
    const value = (word === 'a' || word === 'an' || word === 'one' ? 1 : SMALL[word]!) * MAGNITUDE[match[2]!.toLowerCase()]!;
    add({ value, unit: '', year: false, raw: match[0] }, match.index ?? 0, match[0].length);
  }
  for (const match of source.matchAll(SMALL_WORD)) {
    if (isTaken(match.index ?? 0)) continue;
    add({ value: SMALL[match[1]!.toLowerCase()]!, unit: '', year: false, raw: match[1]! }, match.index ?? 0, match[0].length);
  }
  for (const match of source.matchAll(ROUGH_WORD)) {
    const word = match[1]!.toLowerCase();
    add({ value: ROUGH[word]![0], unit: '~', year: false, raw: match[1]! }, match.index ?? 0, match[0].length);
  }
  for (const match of source.matchAll(MULTIPLIER_VERB)) {
    const [value, unit] = MULTIPLIED[match[1]!.toLowerCase()]!;
    add({ value, unit, year: false, raw: match[0] }, match.index ?? 0, match[0].length);
  }
  return found.sort((a, b) => a.at - b.at).map(({ value, unit, year, raw, ordinal }) => ({ value, unit, year, raw, ordinal }));
}

/** Digits inside identifiers ("p95"): evidence only for the same ordinal ("95th percentile"). */
function identifierDigits(text: string): FoundNumber[] {
  return [...plain(text).matchAll(/(?<=\p{L})(\d+)(?![\p{N}])/gu)].map((match) => ({
    value: Number(match[1]),
    unit: '',
    year: false,
    raw: match[1]!,
  }));
}

const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));

function supports(known: FoundNumber, number: FoundNumber): boolean {
  if (number.unit === '~') {
    const [low, high] = Object.values(ROUGH).find(([start]) => start === number.value) ?? [number.value, number.value];
    return (known.unit === '~' && same(known.value, number.value)) || (!known.unit.startsWith('t:') && known.value >= low && known.value < high);
  }
  if (!same(known.value, number.value)) return false;
  // Dropping a unit claims no more ("40" from "40%"); a new or changed unit does.
  return number.unit === '' || known.unit === number.unit;
}

/**
 * The numbers in `text` that `evidence` doesn't state. Each number in the evidence supports
 * one number in the text: "2,000 requests for 2,000 merchants" needs two.
 */
export function findUnsupportedNumbers(text: string, evidence: string): FoundNumber[] {
  const known = extractNumbers(evidence);
  const identifiers = identifierDigits(evidence);
  const used = new Set<number>();
  const unsupported: FoundNumber[] = [];
  for (const number of extractNumbers(text)) {
    const index = known.findIndex((k, i) => !used.has(i) && supports(k, number));
    if (index !== -1) used.add(index);
    else if (!(number.ordinal && identifiers.some((k) => same(k.value, number.value)))) unsupported.push(number);
  }
  // Digits outside 0-9 that NFKC doesn't fold (Arabic-Indic, Devanagari, ...).
  const evidenceText = plain(evidence);
  for (const match of plain(text).matchAll(/(?![0-9])\p{N}+/gu)) {
    if (!evidenceText.includes(match[0])) unsupported.push({ value: Number.NaN, unit: '', year: false, raw: match[0] });
  }
  return unsupported;
}

export function unsupportedNumbers(text: string, evidence: string): string[] {
  return findUnsupportedNumbers(text, evidence).map((number) => number.raw);
}

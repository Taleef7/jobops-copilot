import { plain } from './text';

/**
 * Numbers in a line, so a tailored line can't add or change a metric (#351, SPEC rule 6).
 *
 * A number is its value with any multiplier applied, and its unit: "%", "cur" (a currency
 * sign), "x", a unit of time ("t:year", "t:hour", ...), or none. "~" marks a rough count
 * ("thousands of"), with the range it stands for. Identifiers that contain a digit (p95, EC2,
 * S3, Q3, OAuth2, COVID-19) are not numbers: a letter right before the digits rules them out.
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
  /** For a rough count ("~"): the values it stands for, [low, high). */
  range?: [number, number];
}

const TIME: Array<[RegExp, string]> = [
  [/^(years?|yrs?|decades?)$/i, 'year'],
  [/^(months?|mos?)$/i, 'month'],
  [/^(weeks?|wks?)$/i, 'week'],
  [/^days?$/i, 'day'],
  [/^(hours?|hrs?)$/i, 'hour'],
  [/^(minutes?|mins?)$/i, 'minute'],
  [/^(seconds?|secs?)$/i, 'second'],
  [/^(ms|milliseconds?)$/i, 'ms'],
];
const TIME_WORDS = 'decades?|years?|yrs?|months?|mos?|weeks?|wks?|days?|hours?|hrs?|minutes?|mins?|seconds?|secs?|milliseconds?|ms';
/** "15-plus years", "10 or more years", "ten-odd years": the unit still belongs to the number. */
const HEDGE = 'plus|or more|or so|odd|full|solid|long';
const TIME_AFTER = new RegExp(String.raw`^(?:[\s-]+(?:${HEDGE}))?[\s-]*(${TIME_WORDS})\b`, 'i');
const timeUnit = (word: string) => `t:${TIME.find(([pattern]) => pattern.test(word))![1]}`;
/** A number word's other units: "four times a year" is 4x, "forty percent" is 40%. */
const OTHER_UNIT_AFTER = /^(?:\s*(percent\b|%)|[\s-]*(times|fold)\b)/i;

const NUMBER = new RegExp(
  String.raw`(?<![\p{L}\p{N}.])(?<!\p{L}-)([$€£¥])?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\+?` +
    String.raw`(?:(?:[\s-]+(?:${HEDGE}))?[\s-]?(${TIME_WORDS})\b` +
    String.raw`|[\s-]?(%|percent\b|times\b|fold\b|k\b|mm?\b|bn?\b|million\b|billion\b|thousand\b|x\b|×))?`,
  'giu',
);
// "by60%": a percentage glued to a word.
const GLUED_PERCENT = /(?<=\p{L})(\d+(?:\.\d+)?)\s?%/gu;
// "x3 faster".
const TIMES_PREFIX = /(?<![\p{L}\p{N}])x(\d+(?:\.\d+)?)(?![\p{L}\p{N}])/giu;

const UNITS: Record<string, number> = {
  zero: 0, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, dozen: 12,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SMALL: Record<string, number> = { ...UNITS, ...TENS };
const ONES = 'one|two|three|four|five|six|seven|eight|nine';
// "twenty-five".
const TENS_AND_ONES = new RegExp(String.raw`\b(${Object.keys(TENS).join('|')})[\s-](${ONES})\b`, 'gi');
const ONE_TO_NINE: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const MAGNITUDE: Record<string, number> = { hundred: 1e2, thousand: 1e3, million: 1e6, billion: 1e9 };
// "two thousand", "a million". "one" and "a" count only before a magnitude or "decade": "one
// of the first" is not a count.
const WORD_TIMES_MAGNITUDE = new RegExp(
  String.raw`\b(a|an|one|${Object.keys(SMALL).join('|')})\s+(hundred|thousand|million|billion)\b`,
  'gi',
);
const DECADES = /\b(a|one|two|three|four)\s+decades?\b|\b(past|last)\s+decade\b|\bdecades\b/gi;
const SMALL_WORD = new RegExp(String.raw`\b(${Object.keys(SMALL).join('|')})\b`, 'gi');
// Rough counts, supported by a number of that size.
const ROUGH: Record<string, [number, number]> = {
  dozens: [24, 200],
  hundreds: [200, 1e3],
  thousands: [2e3, 1e6],
  millions: [2e6, 1e9],
  billions: [2e9, Infinity],
};
const ROUGH_PHRASE = /\b(tens|hundreds)\s+of\s+(thousands|millions|billions)\b/gi;
const ROUGH_WORD = /\b(dozens|hundreds|thousands|millions|billions)\b/gi;
// "doubled", "tripling", "halved", "twice", "by half".
const MULTIPLIER = /\b(?:(doubl|tripl|quadrupl|halv)(?:e|ed|es|ing)|(twice)|(?:by|in) (half))\b/gi;
const MULTIPLIED: Record<string, [number, string]> = {
  doubl: [2, 'x'], tripl: [3, 'x'], quadrupl: [4, 'x'], halv: [50, '%'], twice: [2, 'x'], half: [50, '%'],
};

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

// A four-digit number is a year in a year's context ("since 2018", "2019-2021", "in Q3 2021",
// at the end of a sentence), not before a noun ("2000 merchants").
const YEAR_BEFORE =
  /\b(in|since|from|until|till|through|by|during|of|early|mid|late|q[1-4]|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?)\s+$/i;
const YEAR_AFTER = /^\s*(?:$|[-–,.;:)]|\s(?:and|to|until|through|onward|onwards)\b)/i;

/** ".5M" reads as "0.5M". */
const leadingPoint = (text: string) => text.replace(/(?<![\p{N}])\.(\d)/gu, '0.$1');

export function extractNumbers(text: string): FoundNumber[] {
  const source = leadingPoint(plain(text));
  const found: Array<FoundNumber & { at: number }> = [];
  // Characters already read as part of a number, so a word isn't read twice ("two" in "two thousand").
  const taken = new Uint8Array(source.length + 1);
  const isTaken = (at: number) => taken[at] === 1;
  const add = (number: FoundNumber, at: number, length: number) => {
    found.push({ ...number, at });
    taken.fill(1, at, at + length);
  };
  /** A number word's unit, if one follows it ("ten hours", "four times", "forty percent"). */
  const unitAfter = (end: number) => {
    const rest = source.slice(end);
    const time = TIME_AFTER.exec(rest);
    if (time) return timeUnit(time[1]!);
    const other = OTHER_UNIT_AFTER.exec(rest);
    if (other) return other[1] ? '%' : 'x';
    return '';
  };

  for (const match of source.matchAll(NUMBER)) {
    const [whole, currency, digits = '', decimals, timeWord, suffix] = match;
    const unitWord = suffix?.toLowerCase();
    let value = Number(`${digits.replace(/,/g, '')}${decimals ? `.${decimals}` : ''}`);
    let unit = currency ? 'cur' : '';
    if (timeWord) unit = timeUnit(timeWord);
    if (timeWord && /^decades?$/i.test(timeWord)) value *= 10;
    else if (unitWord === '%' || unitWord === 'percent') unit = '%';
    else if (unitWord === 'x' || unitWord === '×' || unitWord === 'times' || unitWord === 'fold') unit = 'x';
    else if (unitWord) value *= SCALE[unitWord] ?? 1;
    const at = match.index ?? 0;
    const year =
      !currency &&
      !decimals &&
      !unitWord &&
      !timeWord &&
      /^(19|20)\d\d$/.test(digits) &&
      (YEAR_BEFORE.test(source.slice(Math.max(0, at - 12), at)) || YEAR_AFTER.test(source.slice(at + whole.length)));
    const ordinal = /^(st|nd|rd|th)\b/i.test(source.slice((match.index ?? 0) + whole.length));
    add({ value, unit, year, raw: whole.trim(), ordinal }, match.index ?? 0, whole.length);
  }
  for (const match of source.matchAll(GLUED_PERCENT)) {
    add({ value: Number(match[1]), unit: '%', year: false, raw: match[0] }, match.index ?? 0, match[0].length);
  }
  for (const match of source.matchAll(TIMES_PREFIX)) {
    add({ value: Number(match[1]), unit: 'x', year: false, raw: match[0] }, match.index ?? 0, match[0].length);
  }
  for (const match of source.matchAll(DECADES)) {
    // "a decade", "two decades", "the past decade"; "decades" alone is at least two.
    const count = match[1] ? (ONE_TO_NINE[match[1].toLowerCase()] ?? 1) : match[2] ? 1 : 2;
    add({ value: 10 * count, unit: 't:year', year: false, raw: match[0] }, match.index ?? 0, match[0].length);
  }
  for (const match of source.matchAll(ROUGH_PHRASE)) {
    const scale = MAGNITUDE[match[2]!.toLowerCase().replace(/s$/, '')]! * (match[1]!.toLowerCase() === 'tens' ? 10 : 100);
    // "tens of thousands" is 10,000 to 99,999.
    add({ value: scale, unit: '~', year: false, raw: match[0], range: [scale, 10 * scale] }, match.index ?? 0, match[0].length);
  }
  for (const match of source.matchAll(WORD_TIMES_MAGNITUDE)) {
    const word = match[1]!.toLowerCase();
    const value = (word === 'a' || word === 'an' || word === 'one' ? 1 : SMALL[word]!) * MAGNITUDE[match[2]!.toLowerCase()]!;
    add({ value, unit: '', year: false, raw: match[0] }, match.index ?? 0, match[0].length);
  }
  for (const match of source.matchAll(TENS_AND_ONES)) {
    if (isTaken(match.index ?? 0)) continue;
    const value = TENS[match[1]!.toLowerCase()]! + ONE_TO_NINE[match[2]!.toLowerCase()]!;
    const end = (match.index ?? 0) + match[0].length;
    add({ value, unit: unitAfter(end), year: false, raw: match[0] }, match.index ?? 0, match[0].length);
  }
  for (const match of source.matchAll(SMALL_WORD)) {
    if (isTaken(match.index ?? 0)) continue;
    const end = (match.index ?? 0) + match[0].length;
    add({ value: SMALL[match[1]!.toLowerCase()]!, unit: unitAfter(end), year: false, raw: match[1]! }, match.index ?? 0, match[0].length);
  }
  for (const match of source.matchAll(ROUGH_WORD)) {
    if (isTaken(match.index ?? 0)) continue;
    const range = ROUGH[match[1]!.toLowerCase()]!;
    add({ value: range[0], unit: '~', year: false, raw: match[1]!, range }, match.index ?? 0, match[0].length);
  }
  for (const match of source.matchAll(MULTIPLIER)) {
    const [value, unit] = MULTIPLIED[(match[1] ?? match[2] ?? match[3])!.toLowerCase()]!;
    add({ value, unit, year: false, raw: match[0] }, match.index ?? 0, match[0].length);
  }
  return found
    .sort((a, b) => a.at - b.at)
    .map(({ value, unit, year, raw, ordinal, range }) => ({ value, unit, year, raw, ordinal, range }));
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
    const [low, high] = number.range ?? [number.value, number.value];
    if (known.unit === '~') return same(known.value, number.value);
    return !known.unit.startsWith('t:') && known.value >= low && known.value < high;
  }
  // A year needs a year ("the 2023 launch" is one): "2,000 merchants" says nothing about "since 2000".
  if (number.year && !known.year && !/^\d{4}$/.test(known.raw)) return false;
  // A whole multiple is an increase: "2x" is "up 100%", and the other way round. ("40% lower"
  // is not "1.4x faster".)
  const whole = (value: number) => Number.isInteger(value) && value >= 2;
  if (number.unit === 'x' && known.unit === '%') return whole(number.value) && same(known.value, (number.value - 1) * 100);
  if (number.unit === '%' && known.unit === 'x') return whole(known.value) && same(number.value, (known.value - 1) * 100);
  if (!same(known.value, number.value)) return false;
  // Dropping a unit claims no more ("40" from "40%"); a new or changed unit does.
  return number.unit === '' || known.unit === number.unit;
}

// "mid-2015", "Tier-3", "top-10": a number after a word and a hyphen. An all-caps name with a
// number ("COVID-19", "ISO-27001") is a name.
const HYPHENATED = /(?<![\p{L}\p{N}])(\p{L}+)-(\d+(?:\.\d+)?)(?![\p{N}])/gu;

function hyphenatedNumbers(text: string): FoundNumber[] {
  return [...plain(text).matchAll(HYPHENATED)]
    .filter((match) => !/^\p{Lu}{2,}$/u.test(match[1]!))
    .map((match) => ({
      value: Number(match[2]),
      unit: '',
      year: /^(19|20)\d\d$/.test(match[2]!),
      raw: match[0],
    }));
}

/**
 * The numbers in `text` that `evidence` doesn't state. Each number in the evidence supports
 * one number in the text: "2,000 requests for 2,000 merchants" needs two.
 */
export function findUnsupportedNumbers(text: string, evidence: string): FoundNumber[] {
  const known = [...extractNumbers(evidence), ...hyphenatedNumbers(evidence)];
  const identifiers = identifierDigits(evidence);
  const evidenceLower = plain(evidence).toLowerCase();
  // A hyphenated number the evidence has as written ("Tier-1") is checked as that token.
  const hyphenated = hyphenatedNumbers(text).filter((number) => !evidenceLower.includes(number.raw.toLowerCase()));

  // The evidence's numbers by value, so each lookup is quick however many numbers there are.
  const key = (value: number) => Math.round(value * 1e6) / 1e6;
  const byValue = new Map<number, number[]>();
  known.forEach((k, i) => {
    const list = byValue.get(key(k.value));
    if (list) list.push(i);
    else byValue.set(key(k.value), [i]);
  });
  const used = new Set<number>();
  const firstUnused = new Map<number, number>();
  /** The first unused evidence number with this value that supports `number`, or -1. */
  const take = (value: number, number: FoundNumber): number => {
    const list = byValue.get(key(value));
    if (!list) return -1;
    let start = firstUnused.get(key(value)) ?? 0;
    while (start < list.length && used.has(list[start]!)) start += 1;
    firstUnused.set(key(value), start);
    for (let j = start; j < list.length; j += 1) {
      if (!used.has(list[j]!) && supports(known[list[j]!]!, number)) return list[j]!;
    }
    return -1;
  };
  const find = (number: FoundNumber): number => {
    // A rough count ("thousands of") is supported by any number in its range.
    if (number.unit === '~') return known.findIndex((k, i) => !used.has(i) && supports(k, number));
    const exact = take(number.value, number);
    if (exact !== -1) return exact;
    // "2x" against "100%", and the other way round.
    if (number.unit === 'x') return take((number.value - 1) * 100, number);
    if (number.unit === '%') return take(number.value / 100 + 1, number);
    return -1;
  };

  const unsupported: FoundNumber[] = [];
  for (const number of [...extractNumbers(text), ...hyphenated]) {
    const index = find(number);
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

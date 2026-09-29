/**
 * Reads the country a job is in from its location text, when the text says so.
 * It never guesses: "Remote", a bare city, a county name, or anything ambiguous
 * returns null, and the caller asks about "the country where this role is based".
 *
 * Every country name is recognized (from Intl, not a short list), so a location
 * that names two places ("California, China", "Indiana, India", "Poland, Ohio")
 * is ambiguous instead of silently resolving to the one we happen to know.
 *
 * Used to phrase work-authorization questions for the right country, so an
 * answer the user saved for one country is never reused for another (#343).
 *
 * Known limits: a code that is only a US state here can be another country's region
 * ("Perth, WA" in Australia), and a foreign city named without its country is not
 * recognized ("New York or London"). The question names the country it assumed, so
 * the user can see it.
 */

const US = 'the United States';
const UK = 'the United Kingdom';

const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

/** True when a two-letter code is also a country or region code (CA, DE, IN, …). */
function isAlsoCountryCode(code: string): boolean {
  return Boolean(regionNames.of(code));
}

/** "the" for names that take it in "authorized to work in …". */
function withArticle(name: string): string {
  return /^(United |Netherlands$|Philippines$|Bahamas$|Maldives$|Gambia$|Comoros$|Seychelles$)|Islands$|Emirates$/.test(
    name,
  )
    ? `the ${name}`
    : name;
}

const letter = '[\\p{L}\\p{N}]';
/** A whole-word, case-insensitive matcher that also works for non-ASCII names. */
function nameMatcher(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[’']/g, "['’]").replace(/\s+/g, '\\s+');
  return new RegExp(`(?<!${letter})${escaped}(?!${letter})`, 'giu');
}

// Not countries: groupings and placeholders Intl also names.
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ', 'UM']);

/** [how the name can appear in a location, the country it means], longest first. */
const COUNTRY_NAMES: Array<[RegExp, string]> = (() => {
  const entries = new Map<string, string>();
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const a of letters) {
    for (const b of letters) {
      const code = a + b;
      const name = regionNames.of(code);
      if (!name || NOT_COUNTRIES.has(code) || /pseudo|unknown/i.test(name)) continue;
      // Georgia is also a US state: handled separately in detectJobCountry.
      if (name === 'Georgia') continue;
      const country = withArticle(name.replace(/ SAR China$/, '').replace(/\s*\(.*\)$/, ''));
      const spellings = new Set([
        name,
        name.replace(/ SAR China$/, ''), // "Hong Kong"
        name.replace(/\s*\(.*\)$/, ''), // "Myanmar"
        name.replace(/&/g, 'and'), // "Trinidad and Tobago"
      ]);
      for (const spelling of spellings) entries.set(spelling, country);
    }
  }
  const aliases: Record<string, string> = {
    'United States of America': US,
    UK,
    'Great Britain': UK,
    Britain: UK,
    England: UK,
    Scotland: UK,
    Wales: UK,
    'Northern Ireland': UK,
    Holland: 'the Netherlands',
    Turkey: 'Türkiye',
    'Czech Republic': 'Czechia',
    'Ivory Coast': 'Côte d’Ivoire',
    Korea: 'South Korea',
    Burma: 'Myanmar',
    UAE: 'the United Arab Emirates',
  };
  for (const [spelling, country] of Object.entries(aliases)) entries.set(spelling, country);
  return [...entries]
    .sort(([a], [b]) => b.length - a.length)
    .map(([spelling, country]): [RegExp, string] => [nameMatcher(spelling), country]);
})();

const US_EXPLICIT = /(?<![\p{L}\p{N}])(united states( of america)?|u\.s\.a\.?|usa|u\.s\.)(?![\p{L}\p{N}])/giu;

// Capitalised "US" / "UK" anywhere ("Remote (US only)") means the country; lower-case "us" does not.
const US_CODE = /(?<![\p{L}\p{N}])US(?![\p{L}\p{N}])/gu;
const UK_CODE = /(?<![\p{L}\p{N}])UK(?![\p{L}\p{N}])/gu;

const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma',
  'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah',
  'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia',
];
// US places whose names contain a country's ("Jersey" is also a Channel Island).
const US_PLACES = ['Jersey City'];
// Longest first, so "West Virginia" is removed before "Virginia" and "New Jersey" before Jersey.
const US_STATE_NAMES = [...US_PLACES, ...US_STATES].sort((a, b) => b.length - a.length).map(nameMatcher);
const GEORGIA = nameMatcher('Georgia');

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);
// Country codes are only trusted as their own part, in capitals.
const COUNTRY_CODES = new Map([['US', US], ['UK', UK], ['GB', UK]]);
// A state code with a ZIP code ("TX 78701").
const STATE_WITH_ZIP = /^([A-Z]{2})\s+\d{5}(?:-\d{4})?$/;
// Parts of a location: "Austin, TX", "US/UK", "Remote - NY".
const PART_SEPARATORS = /[,/|;·]|\s[-–—]\s/;
// Codes that are a US state and a country: CA (California or Canada), DE (Delaware
// or Germany), IN (Indiana or India), TN (Tennessee or Tunisia), and so on.
const AMBIGUOUS_CODE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${[...US_STATE_CODES].filter(isAlsoCountryCode).join('|')})(?![\\p{L}\\p{N}])`,
  'u',
);

// A US address ends "City, ST[ ZIP], USA". Only there is a code that is also a
// country's (CA, DE, IN) read as a state: "San Francisco, CA 94105, USA".
const US_ADDRESS = /,\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?(?:\s*,\s*|\s+)([^,]+)$/u;
const US_NAME = /^(?:united states(?: of america)?|u\.s\.a\.?|usa|u\.s\.)$/i;

/** The location before its US address ending ("San Francisco"), or null if it has none. */
function beforeUSAddress(location: string): string | null {
  const match = US_ADDRESS.exec(location);
  if (!match || !US_STATE_CODES.has(match[1]!)) return null;
  const country = match[2]!.trim();
  return country === 'US' || US_NAME.test(country) ? location.slice(0, match.index) : null;
}

/**
 * Every country the location points to. More than one means the location is
 * ambiguous, and the caller treats the country as unknown rather than picking one.
 * Matched names are removed as they are found, so a longer name ("New Mexico",
 * "Papua New Guinea") is never counted again as a shorter one ("Mexico", "Guinea").
 */
function countriesMentioned(location: string): Set<string> | null {
  const found = new Set<string>();
  let rest = location;
  const take = (pattern: RegExp, country: string) => {
    pattern.lastIndex = 0;
    if (pattern.test(rest)) {
      found.add(country);
      pattern.lastIndex = 0;
      rest = rest.replace(pattern, ' ');
    }
  };

  const beforeAddress = beforeUSAddress(location);
  if (beforeAddress !== null) {
    found.add(US);
    rest = beforeAddress;
  }
  take(US_EXPLICIT, US);
  take(US_CODE, US);
  take(UK_CODE, UK);
  for (const state of US_STATE_NAMES) take(state, US);
  // Georgia is a US state and a country: it only counts when the location also says USA.
  GEORGIA.lastIndex = 0;
  if (GEORGIA.test(rest)) {
    if (!found.has(US)) return null;
    GEORGIA.lastIndex = 0;
    rest = rest.replace(GEORGIA, ' ');
  }
  for (const [pattern, country] of COUNTRY_NAMES) take(pattern, country);

  // Doubt is read loosely: an ambiguous code anywhere outside a US address could be
  // the other country ("US/CA", "Remote (US, CA)", or "Berlin, DE 10115", where the
  // postal code is German), so the location is unknown.
  if (AMBIGUOUS_CODE.test(rest)) return null;
  // Evidence is read strictly: a code counts only as a part of its own.
  const parts = rest.split(PART_SEPARATORS).map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    const country = COUNTRY_CODES.get(part);
    if (country) found.add(country);
    const code = STATE_WITH_ZIP.exec(part)?.[1] ?? part;
    if (US_STATE_CODES.has(code)) found.add(US);
  }
  return found;
}

export function detectJobCountry(location: string | null | undefined): string | null {
  const text = location?.trim();
  if (!text) return null;
  const found = countriesMentioned(text);
  return found && found.size === 1 ? [...found][0]! : null;
}

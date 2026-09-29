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
// Country codes are only trusted as their own comma-separated part, in capitals.
const COUNTRY_CODES: Record<string, string> = { US, UK, GB: UK };
// A US ZIP code right after a state code ("CA 94105") settles that it is a US state.
const STATE_WITH_ZIP = /^([A-Z]{2})\s+\d{5}(-\d{4})?$/;

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

  const parts = rest.split(/[,/|·]|\s-\s/).map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    if (COUNTRY_CODES[part]) found.add(COUNTRY_CODES[part]!);
    const withZip = STATE_WITH_ZIP.exec(part);
    if (withZip && US_STATE_CODES.has(withZip[1]!)) found.add(US);
    // A code that is also a country (CA = Canada or California) stays ambiguous.
    if (US_STATE_CODES.has(part) && !isAlsoCountryCode(part)) found.add(US);
  }
  return found;
}

export function detectJobCountry(location: string | null | undefined): string | null {
  const text = location?.trim();
  if (!text) return null;
  const found = countriesMentioned(text);
  return found && found.size === 1 ? [...found][0]! : null;
}

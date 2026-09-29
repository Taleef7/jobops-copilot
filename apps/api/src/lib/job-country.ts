/**
 * Reads the country a job is in from its location text, when the text says so.
 * It never guesses: "Remote", a bare city, a county name, or anything ambiguous
 * returns null, and the caller asks about "the country where this role is based".
 *
 * Used to phrase work-authorization questions for the right country, so an
 * answer the user saved for one country is never reused for another (#343).
 */

const US = 'the United States';

const US_EXPLICIT = /\b(united states( of america)?|u\.s\.a\.?|usa|u\.s\.)(?![a-z])/i;

// Checked after US state names, so "New Mexico" is the US and not Mexico.
const COUNTRY_ALIASES: Array<[RegExp, string]> = [
  [/\b(united kingdom|england|scotland|wales|northern ireland|great britain)\b/i, 'the United Kingdom'],
  [/\bcanada\b/i, 'Canada'],
  [/\bireland\b/i, 'Ireland'],
  [/\bgermany\b/i, 'Germany'],
  [/\bfrance\b/i, 'France'],
  [/\b(the )?netherlands\b/i, 'the Netherlands'],
  [/\bspain\b/i, 'Spain'],
  [/\bportugal\b/i, 'Portugal'],
  [/\bpoland\b/i, 'Poland'],
  [/\bsweden\b/i, 'Sweden'],
  [/\bswitzerland\b/i, 'Switzerland'],
  [/\bindia\b/i, 'India'],
  [/\bpakistan\b/i, 'Pakistan'],
  [/\bsingapore\b/i, 'Singapore'],
  [/\baustralia\b/i, 'Australia'],
  [/\bnew zealand\b/i, 'New Zealand'],
  [/\bjapan\b/i, 'Japan'],
  [/(?<!\bnew\s)\bmexico\b/i, 'Mexico'],
  [/\bbrazil\b/i, 'Brazil'],
  [/\bisrael\b/i, 'Israel'],
  [/\b(united arab emirates|uae)\b/i, 'the United Arab Emirates'],
];

// Georgia is left out on purpose: it is also a country.
const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma',
  'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah',
  'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia',
];
const US_STATE_NAME = new RegExp(`\\b(${US_STATES.join('|')})\\b`, 'i');

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

// Country codes are only trusted as their own comma-separated part, in capitals.
const COUNTRY_CODES: Record<string, string> = { US, UK: 'the United Kingdom', GB: 'the United Kingdom' };

// A US ZIP code right after a state code ("CA 94105") settles that it is a US state.
const STATE_WITH_ZIP = /^([A-Z]{2})\s+\d{5}(-\d{4})?$/;

const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

/** True when a two-letter code is also a country or region code (CA, DE, IN, …). */
function isAlsoCountryCode(code: string): boolean {
  return Boolean(regionNames.of(code));
}

export function detectJobCountry(location: string | null | undefined): string | null {
  const text = location?.trim();
  if (!text) return null;

  if (US_EXPLICIT.test(text)) return US;
  if (US_STATE_NAME.test(text)) return US;
  for (const [pattern, country] of COUNTRY_ALIASES) {
    if (pattern.test(text)) return country;
  }

  const parts = text.split(/[,/|·]|\s-\s/).map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    if (COUNTRY_CODES[part]) return COUNTRY_CODES[part]!;
    const withZip = STATE_WITH_ZIP.exec(part);
    if (withZip && US_STATE_CODES.has(withZip[1]!)) return US;
    // A code that is also a country (CA = Canada or California) stays ambiguous.
    if (US_STATE_CODES.has(part) && !isAlsoCountryCode(part)) return US;
  }
  return null;
}

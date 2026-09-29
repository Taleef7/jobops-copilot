/**
 * Reads the country a job is in from its location text, when the text says so.
 * It never guesses: "Remote", a bare city, or a county name return null.
 *
 * Used to phrase work-authorization questions for the right country, so an
 * answer the user saved for one country is never reused for another (#343).
 */

const COUNTRY_ALIASES: Array<[RegExp, string]> = [
  [/\b(united states( of america)?|u\.s\.a\.?|usa|u\.s\.)(?![a-z])/i, 'the United States'],
  [/\b(united kingdom|england|scotland|wales|northern ireland|great britain)\b/i, 'the United Kingdom'],
  [/\bcanada\b/i, 'Canada'],
  [/\bireland\b/i, 'Ireland'],
  [/\bgermany\b/i, 'Germany'],
  [/\bfrance\b/i, 'France'],
  [/\b(netherlands|the netherlands)\b/i, 'the Netherlands'],
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
  [/\bmexico\b/i, 'Mexico'],
  [/\bbrazil\b/i, 'Brazil'],
  [/\bisrael\b/i, 'Israel'],
  [/\bunited arab emirates|\buae\b/i, 'the United Arab Emirates'],
];

// Country codes are only trusted as their own comma-separated part, in capitals.
const COUNTRY_CODES: Record<string, string> = { US: 'the United States', UK: 'the United Kingdom', GB: 'the United Kingdom' };

const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida',
  'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine',
  'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska',
  'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas',
  'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia',
];
const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);
const US_STATE_NAME = new RegExp(`\\b(${US_STATES.join('|')})\\b`, 'i');

export function detectJobCountry(location: string | null | undefined): string | null {
  const text = location?.trim();
  if (!text) return null;

  for (const [pattern, country] of COUNTRY_ALIASES) {
    if (pattern.test(text)) return country;
  }

  const parts = text.split(/[,/|·-]/).map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    if (COUNTRY_CODES[part]) return COUNTRY_CODES[part]!;
    if (US_STATE_CODES.has(part)) return 'the United States';
  }

  // "Washington" alone is ambiguous with the city, but as a US state it still means the US.
  if (US_STATE_NAME.test(text)) return 'the United States';
  return null;
}

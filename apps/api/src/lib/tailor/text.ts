/**
 * Text helpers for checking tailored lines against the base résumé (#351). Comparison is on
 * normalised text, so the model's typography (non-breaking spaces, en dashes, curly quotes,
 * full-width signs) never decides whether a line is supported.
 */

/** Unicode-normalised text: NFKC, plain dashes and quotes, no invisible format characters. */
export function plain(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"');
}

/** Plain text, lower case, without a leading bullet glyph and with single spaces. */
export function norm(text: string): string {
  return plain(text)
    .replace(/^[\s•·▪●◦*-]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const STOPWORDS = new Set(
  (
    'a an and as at be by for from in into is it its of on or our over per than that the their ' +
    'them then this those to up via was were which while who whom with within without across ' +
    'after all also among any are around based before both but can each every had has have he ' +
    'her his how i if more most my new not off only other out she so some such these they through ' +
    'under using we what when where will would you your'
  ).split(' '),
);

/** Number words, which the number check reads; they are not content words. */
const NUMBER_WORDS = new Set(
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety dozen'.split(
    ' ',
  ),
);

/** A crude stem, so "caching"/"cache" and "services"/"service" compare equal. */
export function stem(token: string): string {
  let t = token.replace(/'s$/, '');
  if (t.length > 5 && /(ing|ed)$/.test(t)) t = t.replace(/(ing|ed)$/, '');
  else if (t.length > 4 && /(es|ly)$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 3 && /[^s]s$/.test(t)) t = t.slice(0, -1);
  if (t.length > 3 && t.endsWith('e')) t = t.slice(0, -1);
  return t;
}

/**
 * Verbs a rewording may swap freely ("Built" → "Developed"). Leadership verbs are not here:
 * "led" or "managed" in place of "built" claims more.
 */
export const ACTION_VERBS = new Set(
  (
    'achieve accelerate add automate boost build built collaborate create cut deliver deploy design ' +
    'develop drive drove enable ensure establish help implement improve increase integrate introduce ' +
    'launch lower maintain make made migrate optimize optimise partner provide raise reduce refactor ' +
    'run ran scale set ship speed streamline support use work write wrote written'
  )
    .split(' ')
    .map(stem),
);

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}+#]*(?:[.'][\p{L}\p{N}+#]+)*/gu;

/** Stemmed content words: no stopwords, numbers or number words. */
export function contentTokens(text: string): string[] {
  const tokens = norm(text).match(TOKEN) ?? [];
  return tokens
    .filter((token) => !/^\d[\d.,]*$/.test(token) && !STOPWORDS.has(token) && !NUMBER_WORDS.has(token))
    .map(stem);
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LATIN = /\p{Script=Latin}/u;
const LOOKALIKE = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;

/** Words that mix Latin letters with Cyrillic or Greek look-alikes ("Kаfka" with a Cyrillic а). */
export function mixedScriptWords(text: string): string[] {
  return (plain(text).match(/[\p{L}\p{M}]+/gu) ?? []).filter((word) => LATIN.test(word) && LOOKALIKE.test(word));
}

/** The stems of every word in the text, stopwords included: what a name is checked against. */
export function wordStems(text: string): Set<string> {
  return new Set((norm(text).match(TOKEN) ?? []).map(stem));
}

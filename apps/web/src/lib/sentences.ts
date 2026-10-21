/**
 * A paragraph's sentences, split exactly as the API's cover-letter check splits them
 * (apps/api/src/lib/cover-letter/ground.ts), so a check's `sentence` place means the same here.
 */

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

/**
 * Where a check's sentence is among its paragraph's sentences: at its place, when the sentence
 * there is still it, else the first sentence equal to it (never a substring). -1 when it is gone.
 */
export function sentenceIndex(sentences: string[], check: { text: string; sentence?: number }): number {
  if (check.sentence !== undefined && sentences[check.sentence] === check.text) return check.sentence;
  return sentences.indexOf(check.text);
}

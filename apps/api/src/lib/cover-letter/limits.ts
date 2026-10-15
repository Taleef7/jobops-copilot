import type { CoverLetterLength } from '@/types';

/**
 * How long a cover letter may be (#416). These limits count words and characters, which is what
 * fitting (spacing, margins, then 10 pt) can absorb for ordinary prose: `cover-letter-pdf.test.ts`
 * renders a prose letter at every limit at once on one page. They don't measure width, so text
 * within them can still need two pages (all capitals, very wide letters). The routes render the
 * letter itself and never save or print more than one page: a write is a 503, an edit a 400
 * LETTER_TOO_LONG, a download a 422.
 */

/** The lengths the model is asked for, in words. */
export const TARGET_WORDS: Record<CoverLetterLength, { min: number; max: number }> = {
  concise: { min: 150, max: 200 },
  full: { min: 300, max: 400 },
};

/** A generated letter longer than this didn't follow the brief: the answer can't be used. */
export const MAX_GENERATED_WORDS: Record<CoverLetterLength, number> = { concise: 260, full: 480 };

/** Any letter, the user's edits included. */
export const MAX_LETTER_WORDS = 520;
export const MAX_LETTER_CHARS = 3_600;
export const MAX_PARAGRAPHS = 8;
export const MAX_PARAGRAPH_CHARS = 1_500;

export const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Why a letter is too long for one page, or null. */
export function letterTooLong(paragraphs: string[]): string | null {
  const words = paragraphs.reduce((sum, paragraph) => sum + countWords(paragraph), 0);
  const chars = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
  if (paragraphs.length > MAX_PARAGRAPHS) return `A cover letter has at most ${MAX_PARAGRAPHS} paragraphs.`;
  if (words > MAX_LETTER_WORDS || chars > MAX_LETTER_CHARS) {
    return `This would make the letter longer than one page (${MAX_LETTER_WORDS} words or ${MAX_LETTER_CHARS.toLocaleString('en-US')} characters). Shorten it.`;
  }
  return null;
}

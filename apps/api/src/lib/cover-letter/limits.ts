import type { CoverLetterLength } from '@/types';

/**
 * How long a cover letter may be (#416). The letter is always one page: the PDF fits a long
 * letter (spacing, margins, then 10 pt), and these limits keep every letter the API saves within
 * what fitting can reach. `cover-letter-pdf.test.ts` renders a letter at every limit at once.
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

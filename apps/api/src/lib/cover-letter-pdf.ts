import { PDFDocument } from 'pdf-lib';
import { embedFonts, type Fonts } from '@/lib/pdf/fonts';
import { Flow, PAGE_SIZES, type Run } from '@/lib/pdf/flow';

/**
 * The cover letter PDF (#352), with the résumé's writer and look: the name in small caps over
 * one contact line, the date, the recipient, the subject, and the letter's paragraphs, wrapped.
 *
 * Fitted to one page (#416): a letter that runs past one page at the regular look gets tighter
 * spacing, then 0.75" margins, then 10.5 and 10 pt text; never smaller, and nothing is cut. A
 * letter too long even then is carried onto more pages at the regular look; the cover letter
 * routes never save one (lib/cover-letter/limits.ts).
 */

export interface CoverLetterPdfOptions {
  candidateName: string;
  candidateEmail?: string;
  candidatePhone?: string;
  candidateLocation?: string;
  recipientName?: string;
  recipientRole?: string;
  companyName?: string;
  date?: string;
  subject?: string;
  bodyText: string;
}

interface Step {
  /** The letter's text size, in points. */
  size: number;
  /** Line height, as a multiple of the size. */
  leading: number;
  margin: number;
  /** The space between blocks and paragraphs, as a share of the regular spacing. */
  spacing: number;
}

const STEPS: Step[] = [
  { size: 11, leading: 1.3, margin: 72, spacing: 1 },
  { size: 11, leading: 1.2, margin: 72, spacing: 0.75 },
  { size: 11, leading: 1.2, margin: 54, spacing: 0.6 },
  { size: 10.5, leading: 1.2, margin: 54, spacing: 0.6 },
  { size: 10, leading: 1.15, margin: 54, spacing: 0.5 },
];

/** The contact line's size: the owner's floor for any text. */
const CONTACT_SIZE = 9.5;

function layoutLetter(options: CoverLetterPdfOptions, fonts: Fonts, step: Step): Flow {
  const { size, spacing } = step;
  const flow = new Flow(fonts, { ...PAGE_SIZES.letter, margin: step.margin }, step.leading);
  const text = (value: string, font: Run['font'] = 'regular', at = size): Run => ({ text: value, font, size: at });

  const name = options.candidateName.trim() || 'Candidate';
  flow.write([text(name, 'boldCaps', (size * 20) / 11)], { align: 'center' });
  // Each part whole on a line: an email address is never split.
  const contact = [options.candidateEmail, options.candidatePhone, options.candidateLocation]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  if (contact.length > 0) {
    flow.items(
      contact.map((part) => [text(part, 'regular', CONTACT_SIZE)]),
      text('  |  ', 'regular', CONTACT_SIZE),
    );
  }
  flow.space(4);
  flow.rule(0);
  flow.space(18 * spacing);

  const date = options.date?.trim() || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  flow.write([text(date)]);
  flow.space(12 * spacing);

  const recipient = [
    options.recipientName?.trim() ? text(options.recipientName.trim(), 'bold') : null,
    options.recipientRole?.trim() ? text(options.recipientRole.trim()) : null,
    options.companyName?.trim() ? text(options.companyName.trim()) : null,
  ].filter((run): run is Run => run !== null);
  for (const line of recipient) flow.write([line]);
  if (recipient.length > 0) flow.space(12 * spacing);

  if (options.subject?.trim()) {
    flow.write([text(`Re: ${options.subject.trim()}`, 'bold')]);
    flow.space(12 * spacing);
  }

  const paragraphs = options.bodyText.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  paragraphs.forEach((paragraph, i) => {
    if (i > 0) flow.space(size * 0.8 * spacing);
    // A single line break inside a paragraph is kept ("Sincerely,\nZoë").
    for (const line of paragraph.split('\n')) flow.write([text(line.trim())]);
  });
  return flow;
}

export interface CoverLetterPdf {
  pdf: Buffer;
  pages: number;
  /** Characters the font has no glyph for (CJK, emoji), printed as "?". */
  unsupported: number;
  /** The letter's text size after fitting, in points. */
  size: number;
}

export async function renderCoverLetter(options: CoverLetterPdfOptions, settings: { fit?: boolean } = {}): Promise<CoverLetterPdf> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);
  let step = STEPS[0]!;
  let flow = layoutLetter(options, fonts, step);
  if (settings.fit !== false && flow.pages > 1) {
    for (const tighter of STEPS.slice(1)) {
      const fitted = layoutLetter(options, fonts, tighter);
      if (fitted.pages === 1) {
        step = tighter;
        flow = fitted;
        break;
      }
    }
  }
  flow.draw(doc);
  const name = options.candidateName.trim() || 'Candidate';
  doc.setTitle(options.subject?.trim() ? `${name} – Cover letter – ${options.subject.trim()}` : `${name} – Cover letter`);
  doc.setAuthor(name);
  doc.setCreator('JobOps Copilot');
  doc.setProducer('JobOps Copilot');
  // Classic cross-reference tables: every reader, old parsers included, opens them.
  return {
    pdf: Buffer.from(await doc.save({ useObjectStreams: false })),
    pages: flow.pages,
    unsupported: flow.unsupported,
    size: step.size,
  };
}

export async function renderCoverLetterPdf(options: CoverLetterPdfOptions): Promise<Buffer> {
  return (await renderCoverLetter(options)).pdf;
}

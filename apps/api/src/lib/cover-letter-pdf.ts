import { PDFDocument } from 'pdf-lib';
import { embedFonts } from '@/lib/pdf/fonts';
import { Flow, PAGE_SIZES, type Run } from '@/lib/pdf/flow';

/**
 * The cover letter PDF (#352), with the résumé's writer and look: the name in small caps over
 * one contact line, the date, the recipient, the subject, and the letter's paragraphs, wrapped
 * and carried onto more pages as needed.
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

const SIZE = 11;

export async function renderCoverLetterPdf(options: CoverLetterPdfOptions): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);
  const flow = new Flow(fonts, { ...PAGE_SIZES.letter, margin: 72 }, 1.3);
  const text = (value: string, font: Run['font'] = 'regular', size = SIZE): Run => ({ text: value, font, size });

  const name = options.candidateName.trim() || 'Candidate';
  flow.write([text(name, 'boldCaps', 20)], { center: true });
  const contact = [options.candidateEmail, options.candidatePhone, options.candidateLocation].map((part) => part?.trim()).filter(Boolean);
  if (contact.length > 0) flow.write([text(contact.join('  |  '), 'regular', 9.5)], { center: true });
  flow.space(4);
  flow.rule(0);
  flow.space(18);

  const date = options.date?.trim() || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  flow.write([text(date)]);
  flow.space(12);

  const recipient = [
    options.recipientName?.trim() ? text(options.recipientName.trim(), 'bold') : null,
    options.recipientRole?.trim() ? text(options.recipientRole.trim()) : null,
    options.companyName?.trim() ? text(options.companyName.trim()) : null,
  ].filter((run): run is Run => run !== null);
  for (const line of recipient) flow.write([line]);
  if (recipient.length > 0) flow.space(12);

  if (options.subject?.trim()) {
    flow.write([text(`Re: ${options.subject.trim()}`, 'bold')]);
    flow.space(12);
  }

  const paragraphs = options.bodyText.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  paragraphs.forEach((paragraph, i) => {
    if (i > 0) flow.space(SIZE * 0.8);
    // A single line break inside a paragraph is kept ("Sincerely,\nZoë").
    for (const line of paragraph.split('\n')) flow.write([text(line.trim())]);
  });

  flow.draw(doc);
  doc.setTitle(options.subject?.trim() ? `${name} – Cover letter – ${options.subject.trim()}` : `${name} – Cover letter`);
  doc.setAuthor(name);
  doc.setCreator('JobOps Copilot');
  doc.setProducer('JobOps Copilot');
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

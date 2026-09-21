/**
 * Deterministic, ATS-safe Cover Letter PDF generator.
 *
 * Produces valid, standard PDF 1.4 binary documents using the shared PDF pipeline:
 * clean typography (Helvetica), standard Letter layout (612 x 792 pt),
 * proper line wrapping, and deterministic cross-reference offsets.
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

function escapePdfString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

interface TextItem {
  text: string;
  size: number;
  bold?: boolean;
  indent?: number;
  gapBefore?: number;
}

function wrapParagraph(text: string, maxCharsPerLine: number = 82): string[] {
  if (!text.trim()) return [''];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxCharsPerLine) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

export function renderCoverLetterPdf(options: CoverLetterPdfOptions): Buffer {
  const items: TextItem[] = [];

  // 1. Candidate Header Block
  const name = options.candidateName.trim() || 'Candidate';
  items.push({ text: name, size: 20, bold: true, gapBefore: 0 });

  const contactParts: string[] = [];
  if (options.candidateEmail) contactParts.push(options.candidateEmail);
  if (options.candidatePhone) contactParts.push(options.candidatePhone);
  if (options.candidateLocation) contactParts.push(options.candidateLocation);

  if (contactParts.length > 0) {
    items.push({ text: contactParts.join(' | '), size: 9.5, gapBefore: 4 });
  }

  // 2. Date
  const dateStr =
    options.date ||
    new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  items.push({ text: dateStr, size: 10, gapBefore: 18 });

  // 3. Recipient Block
  if (options.recipientName || options.companyName || options.recipientRole) {
    let hasAddedRecipientLine = false;
    if (options.recipientName) {
      items.push({
        text: options.recipientName,
        size: 10,
        bold: true,
        gapBefore: 14,
      });
      hasAddedRecipientLine = true;
    }
    if (options.recipientRole) {
      items.push({
        text: options.recipientRole,
        size: 10,
        gapBefore: hasAddedRecipientLine ? 3 : 14,
      });
      hasAddedRecipientLine = true;
    }
    if (options.companyName) {
      items.push({
        text: options.companyName,
        size: 10,
        gapBefore: hasAddedRecipientLine ? 3 : 14,
      });
    }
  }

  // 4. Subject line if present
  if (options.subject) {
    items.push({
      text: `RE: ${options.subject}`,
      size: 10.5,
      bold: true,
      gapBefore: 16,
    });
  }

  // 5. Letter Body
  // Normalize newlines and wrap each paragraph
  const rawParagraphs = options.bodyText.split(/\r?\n\r?\n/);
  let isFirstParagraph = true;

  for (const para of rawParagraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    const wrappedLines = wrapParagraph(trimmed);
    for (let i = 0; i < wrappedLines.length; i++) {
      const line = wrappedLines[i]!;
      items.push({
        text: line,
        size: 10,
        gapBefore: i === 0 ? (isFirstParagraph ? (options.subject ? 14 : 18) : 12) : 4,
      });
    }
    isFirstParagraph = false;
  }

  // 6. Sign-off
  items.push({ text: 'Sincerely,', size: 10, gapBefore: 18 });
  items.push({ text: name, size: 10.5, bold: true, gapBefore: 16 });

  // Layout calculations (Letter: 612 x 792 pt, 54 pt margins)
  const startX = 54;
  let currentY = 738; // 792 - 54
  const streamOps: string[] = [];

  for (const item of items) {
    currentY -= (item.gapBefore ?? 0) + item.size;
    const fontName = item.bold ? '/F2' : '/F1';
    const xPos = startX + (item.indent ?? 0);
    const escaped = escapePdfString(item.text);

    streamOps.push(
      'BT',
      `${fontName} ${item.size} Tf`,
      `1 0 0 1 ${xPos} ${currentY} Tm`,
      `(${escaped}) Tj`,
      'ET',
    );
  }

  const streamContent = streamOps.join('\n');
  const streamLength = Buffer.byteLength(streamContent);

  // Construct standard PDF 1.4 objects
  const objects: string[] = [
    // 1: Catalog
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    // 2: Pages
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    // 3: Page
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj`,
    // 4: Contents
    `4 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream\nendobj`,
    // 5: Helvetica Normal
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
    // 6: Helvetica Bold
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj',
  ];

  // Assemble PDF with exact cross-reference table
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${obj}\n`;
  }

  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    const off = offsets[i]!;
    pdf += `${off.toString().padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf-8');
}

/**
 * Builds small, valid PDFs for tests. Generated at test time so the repo carries no binary
 * fixtures.
 */

const escapePdfText = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`);

/** One text line per page. */
export function buildPdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((text, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    const stream = `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });
  return writePdf(objects);
}

/** A piece of text drawn at its own position, the way PDF writers emit bold runs. */
export interface PdfRun {
  text: string;
  /** Left edge in points. */
  x: number;
  bold?: boolean;
}

/**
 * One page whose lines are drawn as separately positioned runs, in Helvetica and
 * Helvetica-Bold (WinAnsi, so "–" and "•" work). Each line is 16 pt below the last. This is
 * how a real résumé reaches the text extractor: "Encoded", a bold "9" and "regulatory…"
 * arrive as three items with only a gap between them, no space character.
 */
export function buildPdfFromRuns(lines: PdfRun[][]): Buffer {
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [5 0 R] /Count 1 >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  const toWinAnsi = (text: string) => text.replace(/–/g, '\x96').replace(/•/g, '\x95');
  const stream = lines
    .flatMap((runs, index) =>
      runs.map(
        (run) =>
          `BT /${run.bold ? 'F2' : 'F1'} 11 Tf 1 0 0 1 ${run.x.toFixed(2)} ${720 - index * 16} Tm ` +
          `(${escapePdfText(toWinAnsi(run.text))}) Tj ET`,
      ),
    )
    .join('\n');
  objects[5] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 6 0 R >>';
  objects[6] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  return writePdf(objects);
}

/** Helvetica advance widths (per 1000 units of font size) for the characters the tests use. */
const HELVETICA_WIDTHS: Record<string, number> = {
  E: 667, R: 722, a: 556, c: 500, d: 556, e: 556, g: 556, l: 222, n: 556, o: 556, r: 333, t: 278, u: 556, y: 500,
};

/** The width of `text` in regular Helvetica at `size`, as pdf.js measures it. */
export function helveticaWidth(text: string, size = 11): number {
  return [...text].reduce((sum, char) => {
    const width = HELVETICA_WIDTHS[char];
    if (width === undefined) throw new Error(`helveticaWidth: no width for ${JSON.stringify(char)}`);
    return sum + (width * size) / 1000;
  }, 0);
}

function writePdf(objects: string[]): Buffer {
  // The conventional layout (a binary marker line, CRLF cross-reference entries), padded with
  // comment lines to about 4 KB: the pdf.js inside pdf-parse misreads some PDFs under ~2 KB,
  // which real résumés never are.
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n' + `%${'x'.repeat(63)}\n`.repeat(64);
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f\r\n`;
  for (let id = 1; id < objects.length; id += 1) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n\r\n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** The first bytes of a PNG, padded: an image renamed to .pdf. */
export function fakePng(): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 1)]);
}

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument, PDFFont } from 'pdf-lib';

/**
 * Source Serif 4 (SIL Open Font License 1.1, assets/fonts/OFL.txt), embedded and subset in
 * every PDF the API writes (#352): any Latin, Greek or Cyrillic name prints as written.
 * Small caps are the font's own (OpenType smcp), so "Zoë" still extracts as "Zoë".
 */

export interface Fonts {
  regular: PDFFont;
  italic: PDFFont;
  bold: PDFFont;
  /** Small caps, for section headings. */
  caps: PDFFont;
  /** Bold small caps, for the name. */
  boldCaps: PDFFont;
}

export type FontName = keyof Fonts;

const FILES = { regular: 'SourceSerif4-Regular.ttf', italic: 'SourceSerif4-Italic.ttf', bold: 'SourceSerif4-Bold.ttf' };

/** apps/api/assets/fonts: from src/lib/pdf here, from dist/lib/pdf in the deploy package. */
function fontDir(start = __dirname): string {
  let dir = start;
  for (let hop = 0; hop < 8; hop += 1) {
    const candidate = join(dir, 'assets', 'fonts');
    if (existsSync(join(candidate, FILES.regular))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('assets/fonts not found: the PDF fonts must ship with the API');
}

let bytes: Record<keyof typeof FILES, Uint8Array> | null = null;

export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  if (!bytes) {
    const dir = fontDir();
    bytes = {
      regular: readFileSync(join(dir, FILES.regular)),
      italic: readFileSync(join(dir, FILES.italic)),
      bold: readFileSync(join(dir, FILES.bold)),
    };
  }
  doc.registerFontkit(fontkit);
  const smallCaps = { smcp: true };
  const [regular, italic, bold, caps, boldCaps] = await Promise.all([
    doc.embedFont(bytes.regular, { subset: true }),
    doc.embedFont(bytes.italic, { subset: true }),
    doc.embedFont(bytes.bold, { subset: true }),
    doc.embedFont(bytes.regular, { subset: true, features: smallCaps }),
    doc.embedFont(bytes.bold, { subset: true, features: smallCaps }),
  ]);
  return { regular, italic, bold, caps, boldCaps };
}

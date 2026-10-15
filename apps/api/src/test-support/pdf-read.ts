import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * Reads a PDF the way a strict reader does (pdfjs-dist), for tests: each page's size, its text
 * items with position, width and font name, and its link annotations.
 */

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  font: string;
}

export interface PdfPage {
  width: number;
  height: number;
  items: PdfTextItem[];
  links: string[];
  /** The page's text, a line per baseline, top to bottom. */
  lines: string[];
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjs: Promise<PdfJs> | null = null;

export async function readPdf(buffer: Uint8Array): Promise<{ pages: PdfPage[]; text: string }> {
  pdfjs ??= import(pathToFileURL(createRequire(__filename).resolve('pdfjs-dist/legacy/build/pdf.mjs')).href) as Promise<PdfJs>;
  const { getDocument } = await pdfjs;
  // pdfjs throws on a malformed file (the old writer's "bad XRef entry").
  const task = getDocument({ data: new Uint8Array(buffer), verbosity: 0, fontExtraProperties: true, stopAtErrors: true });
  const doc = await task.promise;
  const pages: PdfPage[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    await page.getOperatorList();
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue;
      const font = (page.commonObjs.get(item.fontName) as { name?: string } | undefined)?.name ?? item.fontName;
      items.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, font });
    }
    const byLine = new Map<number, PdfTextItem[]>();
    for (const item of items) {
      const key = Math.round(item.y);
      byLine.set(key, [...(byLine.get(key) ?? []), item]);
    }
    const lines = [...byLine.entries()]
      .sort(([a], [b]) => b - a)
      .map(([, row]) => row.sort((a, b) => a.x - b.x).map((item) => item.str).join(''));
    const annotations = (await page.getAnnotations()) as Array<{ subtype?: string; url?: string }>;
    pages.push({ width, height, items, links: annotations.filter((a) => a.subtype === 'Link' && a.url).map((a) => a.url!), lines });
  }
  await task.destroy();
  return { pages, text: pages.flatMap((page) => page.lines).join('\n') };
}

/** Text with each run of whitespace as one space, to compare across line breaks. */
export const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

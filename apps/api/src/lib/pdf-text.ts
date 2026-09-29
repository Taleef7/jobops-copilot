/**
 * Read the text of an uploaded PDF off the event loop (#389).
 *
 * pdf-parse bundles an old pdf.js that parses on whatever thread calls it, with no time
 * limit, so one hostile PDF could stall the single API process for every user. The work
 * runs in a worker thread with a time limit and a memory limit, reads at most a few pages,
 * and keeps at most a résumé's worth of text.
 */

import { Worker } from 'node:worker_threads';

export const PDF_MAX_PAGES = 10;
export const PDF_MAX_CHARS = 50_000;
const PDF_TIMEOUT_MS = 10_000;
const PDF_WORKER_MEMORY_MB = 256;

/** The PDF can't be read: malformed, too many pages, too slow, or too big to parse. */
export class PdfUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfUnreadableError';
  }
}

export interface PdfText {
  text: string;
  pages: number;
  /** The text was longer than `maxChars` and was cut. */
  truncated: boolean;
}

export interface PdfTextOptions {
  timeoutMs?: number;
  maxPages?: number;
  maxChars?: number;
}

// Plain JavaScript run with `eval`, so it works the same from the TypeScript sources in
// tests and from the compiled build. pdf-parse is loaded by absolute path: its index.js
// has a debug block that reads a test file when it isn't required as a dependency.
//
// The bytes are copied into a Buffer with memory of its own. Small Buffers are slices of a
// shared pool, and this pdf.js reads the whole underlying memory, so offsets land in the
// wrong place and small PDFs fail with "bad XRef entry" depending on where they sit.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const pdfParse = require(workerData.modulePath);
const source = new Uint8Array(workerData.data);
const bytes = Buffer.alloc(source.length);
bytes.set(source);
pdfParse(bytes, { max: workerData.maxPages })
  .then((result) => parentPort.postMessage({ ok: true, text: result.text || '', pages: result.numpages || 0 }))
  .catch((error) => parentPort.postMessage({ ok: false, error: String((error && error.message) || error) }));
`;

export function extractPdfText(data: Buffer, options: PdfTextOptions = {}): Promise<PdfText> {
  const { timeoutMs = PDF_TIMEOUT_MS, maxPages = PDF_MAX_PAGES, maxChars = PDF_MAX_CHARS } = options;
  const modulePath = require.resolve('pdf-parse/lib/pdf-parse.js');

  return new Promise<PdfText>((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { data, modulePath, maxPages },
      resourceLimits: { maxOldGenerationSizeMb: PDF_WORKER_MEMORY_MB },
    });
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      outcome();
    };
    const timer = setTimeout(
      () => finish(() => reject(new PdfUnreadableError('Reading the PDF took too long.'))),
      timeoutMs,
    );

    worker.once('message', (message: { ok: boolean; text?: string; pages?: number; error?: string }) => {
      if (!message.ok) {
        finish(() => reject(new PdfUnreadableError(message.error ?? 'The PDF could not be read.')));
        return;
      }
      const pages = message.pages ?? 0;
      if (pages > maxPages) {
        finish(() =>
          reject(new PdfUnreadableError(`It has ${pages.toLocaleString('en-US')} pages; a résumé should be ${maxPages} pages or fewer.`)),
        );
        return;
      }
      const text = (message.text ?? '').trim();
      finish(() =>
        resolve({ text: text.slice(0, maxChars), pages, truncated: text.length > maxChars }),
      );
    });
    worker.once('error', (error) => finish(() => reject(new PdfUnreadableError(error.message))));
    worker.once('exit', (code) => finish(() => reject(new PdfUnreadableError(`The PDF reader stopped (exit ${code}).`))));
  });
}

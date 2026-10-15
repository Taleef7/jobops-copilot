// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadPdf } from './pdf-pages';

// pdf.js for real, not mocked (#415): the preview's loading half, on a résumé the API's renderer
// drew (__fixtures__/resume.pdf). The modern build calls APIs older browsers lack
// (Uint8Array.prototype.toHex, Map.prototype.getOrInsertComputed); the legacy build doesn't.
it("reads the API's résumé PDF with pdf.js: its pages, fonts and text", async () => {
  const data = readFileSync(join(__dirname, '__fixtures__', 'resume.pdf'));
  const task = await loadPdf(new Uint8Array(data).buffer);
  try {
    const doc = await task.promise;
    expect(doc.numPages).toBe(1);
    const page = await doc.getPage(1);
    // Drawing a page needs its operators, fonts included.
    expect((await page.getOperatorList()).fnArray.length).toBeGreaterThan(50);
    const text = (await page.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' ');
    expect(text).toContain('Zoë Núñez');
    expect(text.indexOf('Technical Skills')).toBeLessThan(text.indexOf('Experience'));
  } finally {
    await task.destroy();
  }
});

// Codex on #436: with no workerSrc, pdf.js needs `globalThis.pdfjsWorker` to run on the main
// thread. The worker module sets it once, on its first import; loadPdf sets it every time.
it('gives pdf.js its main-thread worker on every load', async () => {
  const data = readFileSync(join(__dirname, '__fixtures__', 'resume.pdf'));
  const scope = globalThis as { pdfjsWorker?: { WorkerMessageHandler?: unknown } };
  const handler = () => scope.pdfjsWorker?.WorkerMessageHandler;
  await (await loadPdf(new Uint8Array(data).buffer)).destroy();
  delete scope.pdfjsWorker;

  const task = await loadPdf(new Uint8Array(data).buffer);
  try {
    expect(handler()).toBeTruthy();
    expect((await task.promise).numPages).toBe(1);
  } finally {
    await task.destroy();
  }
});

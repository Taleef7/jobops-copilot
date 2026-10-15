/**
 * Draws a PDF's pages into canvases, in the browser, with pdf.js (#415): the résumé preview in
 * Settings. No frame and no browser PDF viewer, so it shows under the app's CSP
 * (`object-src 'none'`) and on phones, whose browsers don't show a PDF inside a page. pdf.js
 * runs on the main thread (its worker module loaded alongside): a résumé is a page or two.
 */
/**
 * Starts reading a PDF with pdf.js; the caller destroys the task. The legacy build: the modern
 * one calls Uint8Array.prototype.toHex, Map.prototype.getOrInsertComputed and Math.sumPrecise,
 * which Chrome before ~140 and older Safari don't have.
 */
export async function loadPdf(data: ArrayBuffer) {
  const [pdfjs] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.mjs')]);
  return pdfjs.getDocument({ data: new Uint8Array(data) });
}

export async function renderPdfPages(data: ArrayBuffer, cssWidth: number): Promise<HTMLCanvasElement[]> {
  const task = await loadPdf(data);
  const doc = await task.promise;
  try {
    const canvases: HTMLCanvasElement[] = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      // Sharp on high-density screens: drawn at the device's pixels, shown at the frame's width.
      const scale = (cssWidth / page.getViewport({ scale: 1 }).width) * (window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      canvases.push(canvas);
    }
    return canvases;
  } finally {
    await task.destroy();
  }
}

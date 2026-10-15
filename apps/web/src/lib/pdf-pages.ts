/**
 * Draws a PDF's pages into canvases, in the browser, with pdf.js (#415): the résumé preview in
 * Settings. No frame and no browser PDF viewer, so it shows under the app's CSP
 * (`object-src 'none'`) and on phones, whose browsers don't show a PDF inside a page. pdf.js
 * runs on the main thread (its worker module loaded alongside): a résumé is a page or two.
 */
export async function renderPdfPages(data: ArrayBuffer, cssWidth: number): Promise<HTMLCanvasElement[]> {
  const [pdfjs] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs')]);
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
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

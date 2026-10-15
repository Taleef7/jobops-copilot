'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { downloadBaseResumePdf, errorMessage, fetchBaseResumePdf } from '@/lib/api';
import { renderPdfPages } from '@/lib/pdf-pages';

interface ResumePdfPreviewProps {
  /** The name on the résumé, for "First Last – Résumé.pdf". */
  name: string;
  /** No résumé yet: there is nothing to render. */
  disabled?: boolean;
  /** Goes up with every save: a preview of the résumé before it is dropped. */
  changes?: number;
  /** Settles once changes still being saved (the layout's) are: the PDF waits for them. */
  pending?: () => Promise<void>;
}

interface Preview {
  data: ArrayBuffer;
  pages: number;
  unsupported: number;
}

const unprintable = (count: number) =>
  `${count} characters in your résumé can't be printed in its font (Chinese, Japanese, Korean, Arabic, emoji…) and show as "?".`;

/**
 * The base résumé's PDF as saved (#415), in its layout: its pages drawn here, with the page
 * count, or downloaded. The API renders it on the request and stores nothing. The pages are
 * drawn with pdf.js, not shown in a frame: the app's CSP (`object-src 'none'`) can stop the
 * browser's PDF viewer, and phones don't show a PDF inside a page.
 */
export function ResumePdfPreview({ name, disabled = false, changes = 0, pending }: ResumePdfPreviewProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // A save makes the preview out of date: it goes, and Preview PDF shows the new one.
  const [shownFor, setShownFor] = useState(changes);
  if (shownFor !== changes) {
    setShownFor(changes);
    setPreview(null);
    setError(null);
  }

  // For a render on its way: the latest save it has to include, and whether it's still wanted.
  const latest = useRef(changes);
  const mounted = useRef(true);
  useEffect(() => {
    latest.current = changes;
  }, [changes]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function show() {
    setLoading(true);
    setError(null);
    try {
      // A save made while it renders makes it out of date: it renders again (a few times at most).
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await pending?.();
        const asOf = latest.current;
        const { blob, pages, unsupported } = await fetchBaseResumePdf();
        const data = await blob.arrayBuffer();
        if (!mounted.current) return;
        if (asOf === latest.current) {
          setPreview({ data, pages, unsupported });
          return;
        }
      }
    } catch (err) {
      setPreview(null);
      setError(errorMessage(err, "The PDF couldn't be made. Try again in a moment."));
    } finally {
      setLoading(false);
    }
  }

  async function download() {
    setDownloading(true);
    try {
      await pending?.();
      const { unsupported } = await downloadBaseResumePdf(`${name.trim() || 'Resume'} – Résumé.pdf`);
      if (unsupported) toast.warning(unprintable(unsupported));
    } catch (err) {
      toast.error(errorMessage(err, "The PDF couldn't be downloaded. Try again in a moment."));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled || loading} onClick={() => void show()}>
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Preview PDF
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={disabled || downloading} onClick={() => void download()}>
          {downloading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Download PDF
        </Button>
        <p className="text-muted-foreground text-xs">Shows your saved résumé.</p>
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      {preview ? (
        <div className="space-y-2">
          <p role="status" className="text-sm">{`Your PDF is ${preview.pages} ${preview.pages === 1 ? 'page' : 'pages'}.`}</p>
          {preview.unsupported ? <p className="text-xs text-amber-700 dark:text-amber-400">{unprintable(preview.unsupported)}</p> : null}
          <PdfPages data={preview.data} />
        </div>
      ) : null}
    </div>
  );
}

/** The PDF's pages, drawn one under the other at the width there is. */
function PdfPages({ data }: { data: ArrayBuffer }) {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!frame) return;
    let current = true;
    renderPdfPages(data, frame.clientWidth || 800)
      .then((canvases) => {
        if (!current) return;
        canvases.forEach((canvas, index) => {
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `Page ${index + 1} of ${canvases.length}`);
          canvas.className = 'h-auto w-full rounded-md border bg-white shadow-sm';
        });
        frame.replaceChildren(...canvases);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [data, frame]);

  if (failed) {
    return <p className="text-muted-foreground text-sm">The pages couldn&apos;t be shown here. Download PDF has it.</p>;
  }
  return <div ref={setFrame} role="group" aria-label="Résumé PDF preview" className="max-w-3xl space-y-3" />;
}

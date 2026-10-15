'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { downloadBaseResumePdf, errorMessage, fetchBaseResumePdf } from '@/lib/api';

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
  url: string;
  pages: number;
  unsupported: number;
}

const unprintable = (count: number) =>
  `${count} characters in your résumé can't be printed in its font (Chinese, Japanese, Korean, Arabic, emoji…) and show as "?".`;

/**
 * The base résumé's PDF as saved (#415), in its layout: shown here with its page count, or
 * downloaded. The API renders it on the request and stores nothing.
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

  // The PDF is held in memory until it's replaced or dropped.
  useEffect(() => {
    if (!preview) return;
    const { url } = preview;
    return () => URL.revokeObjectURL(url);
  }, [preview]);
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
        const url = URL.createObjectURL(blob);
        if (mounted.current && asOf === latest.current) {
          setPreview({ url, pages, unsupported });
          return;
        }
        URL.revokeObjectURL(url);
        if (!mounted.current) return;
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
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <p role="status">{`Your PDF is ${preview.pages} ${preview.pages === 1 ? 'page' : 'pages'}.`}</p>
            <a href={preview.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              Open the PDF in a new tab
            </a>
          </div>
          {preview.unsupported ? <p className="text-xs text-amber-700 dark:text-amber-400">{unprintable(preview.unsupported)}</p> : null}
          {/* Phones open the PDF in a tab instead: their browsers don't show one in a frame. */}
          <iframe title="Résumé PDF preview" src={preview.url} className="hidden h-[42rem] w-full rounded-md border sm:block" />
        </div>
      ) : null}
    </div>
  );
}

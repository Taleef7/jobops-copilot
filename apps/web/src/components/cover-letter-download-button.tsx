'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { downloadCoverLetterPdf } from '@/lib/api';

interface CoverLetterDownloadButtonProps {
  outreachId: string;
  company?: string;
  candidateName?: string;
}

export function CoverLetterDownloadButton({
  outreachId,
  company,
  candidateName,
}: CoverLetterDownloadButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  async function handleDownload() {
    setIsDownloading(true);
    try {
      const safeCandidate = (candidateName || 'Candidate').replace(/\s+/g, '_');
      const safeCompany = (company || 'Company').replace(/\s+/g, '_');
      const filename = `Cover_Letter_${safeCandidate}_${safeCompany}.pdf`;
      await downloadCoverLetterPdf(outreachId, filename);
      toast.success('Cover letter PDF downloaded successfully!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to download cover letter PDF.';
      toast.error(msg);
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isDownloading}
      onClick={handleDownload}
      className="gap-1.5"
    >
      {isDownloading ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Download className="size-3.5" />
      )}
      Download PDF
    </Button>
  );
}

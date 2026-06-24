'use client';

import { Target } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ApiRequestError, scoreFit } from '@/lib/api';

type JobAnalysisActionsProps = {
  jobId: string;
  /** True when the stored analysis is a free estimate (local-prerank): upgrade it
   *  to a real LLM score once, silently, on open. */
  autoScore?: boolean;
};

// "Score fit" is the single analysis action: it parses the job and scores the
// fit in one step, then persists the scored analysis. (The old "Parse job"
// button saved a fit-less heuristic that overwrote a good score — removed.)
export function JobAnalysisActions({ jobId, autoScore = false }: JobAnalysisActionsProps) {
  const router = useRouter();
  const [isScoring, setIsScoring] = useState(false);
  const autoFired = useRef(false);

  async function handleScore({ silent = false }: { silent?: boolean } = {}) {
    setIsScoring(true);
    try {
      const scored = await scoreFit({ jobId });
      if (!silent) toast.success(`Fit score saved: ${scored.fit_score}/100`);
      router.refresh();
    } catch (error) {
      // The automatic upgrade stays quiet on failure (e.g. daily budget reached):
      // the estimate remains and the manual button is the fallback.
      if (!silent) {
        toast.error(error instanceof ApiRequestError ? error.message : 'Failed to score the fit.');
      }
    } finally {
      setIsScoring(false);
    }
  }

  useEffect(() => {
    if (autoScore && !autoFired.current) {
      autoFired.current = true;
      void handleScore({ silent: true });
    }
    // Fire at most once per mount for an estimated job; jobId/autoScore are stable
    // for the lifetime of the detail page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScore, jobId]);

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => void handleScore()} disabled={isScoring} className="gap-1.5">
        <Target className="size-4" />
        {isScoring ? 'Scoring…' : 'Score fit'}
      </Button>
    </div>
  );
}

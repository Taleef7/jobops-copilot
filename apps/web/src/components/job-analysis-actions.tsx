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
  // Track which job we auto-scored, not just whether we did, so a reused
  // component instance (client-side nav to a different job) still upgrades the
  // new estimate exactly once.
  const autoScoredJobId = useRef<string | null>(null);

  async function handleScore({ silent = false }: { silent?: boolean } = {}) {
    setIsScoring(true);
    try {
      const scored = await scoreFit({ jobId });
      if (!silent) toast.success(`Fit score saved: ${scored.fit_score}/100`);
      // Always refresh so the upgraded score is reflected in the UI, even silently.
      router.refresh();
    } catch (error) {
      // The automatic upgrade stays quiet on expected failures (e.g. daily budget
      // reached): the estimate remains and the manual button is the fallback.
      if (!silent) {
        toast.error(error instanceof ApiRequestError ? error.message : 'Failed to score the fit.');
      } else if (!(error instanceof ApiRequestError)) {
        // Surface unexpected failures (network/parse/bugs) to the console even in
        // silent mode so they aren't swallowed entirely.
        console.error('[JobAnalysisActions] auto-score failed unexpectedly', error);
      }
    } finally {
      setIsScoring(false);
    }
  }

  useEffect(() => {
    if (autoScore && autoScoredJobId.current !== jobId) {
      autoScoredJobId.current = jobId;
      void handleScore({ silent: true });
    }
    // Listing handleScore (defined inline, not memoised) would re-fire the effect
    // on every render; the autoScoredJobId ref is the real once-per-job guard. The
    // effect only reads jobId/autoScore, so those are the deps we declare.
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

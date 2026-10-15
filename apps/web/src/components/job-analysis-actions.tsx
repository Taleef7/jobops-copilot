'use client';

import { Target } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { ApiRequestError, scoreFit } from '@/lib/api';

type JobAnalysisActionsProps = {
  jobId: string;
  /** True when the stored analysis is a free estimate (local-prerank): upgrade it
   *  to a real LLM score once, silently, on open. */
  autoScore?: boolean;
  /** True when the page was opened with `?run=fit` by the Add job form's "Save and run fit"
   *  (#355): run Score fit once on open, as if it were clicked. */
  runFit?: boolean;
};

/** Drop `?run=fit` from the address once the run has started, so a reload or Back to the
 *  page doesn't start (and pay for) another. Next keeps its router in step with this. */
function forgetRunParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('run')) return;
  url.searchParams.delete('run');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

// "Score fit" is the single analysis action: it parses the job and scores the
// fit in one step, then persists the scored analysis. (The old "Parse job"
// button saved a fit-less heuristic that overwrote a good score — removed.)
export function JobAnalysisActions({ jobId, autoScore = false, runFit = false }: JobAnalysisActionsProps) {
  const router = useRouter();
  const [isScoring, setIsScoring] = useState(false);
  // Why the last Score fit failed, shown under the button with a retry (#349).
  const [failure, setFailure] = useState<string | null>(null);
  // Track which job we scored on open, not just whether we did, so a reused
  // component instance (client-side nav to a different job) still upgrades the
  // new estimate exactly once. It also holds React's second effect run in development.
  const autoScoredJobId = useRef<string | null>(null);
  // One score at a time, for the button and the automatic upgrade alike (#353). `isScoring`
  // disables the button only after a re-render: a click while the page hydrated ran
  // alongside the automatic score and sent a second POST.
  const scoring = useRef(false);
  // Whether the running score reports its result. A click during the automatic one makes
  // it report, since the click sends nothing of its own.
  const quiet = useRef(false);

  async function handleScore({ silent = false }: { silent?: boolean } = {}) {
    if (scoring.current) {
      if (!silent) quiet.current = false;
      return;
    }
    scoring.current = true;
    quiet.current = silent;
    setIsScoring(true);
    setFailure(null);
    try {
      const scored = await scoreFit({ jobId });
      // A score is always the AI's: when it can't answer, the API says so (503) instead
      // of making one up (#349).
      if (!quiet.current) toast.success(`Fit score saved: ${scored.fit_score}/100`);
      // Always refresh so the upgraded score is reflected in the UI, even silently.
      router.refresh();
    } catch (error) {
      // The automatic upgrade stays quiet on expected failures (e.g. daily budget
      // reached): the estimate remains and the manual button is the fallback.
      if (!quiet.current) {
        setFailure(error instanceof ApiRequestError ? error.message : 'Scoring failed. Try again.');
      } else if (!(error instanceof ApiRequestError)) {
        // Surface unexpected failures (network/parse/bugs) to the console even in
        // silent mode so they aren't swallowed entirely.
        console.error('[JobAnalysisActions] auto-score failed unexpectedly', error);
      }
    } finally {
      scoring.current = false;
      setIsScoring(false);
    }
  }

  useEffect(() => {
    if ((autoScore || runFit) && autoScoredJobId.current !== jobId) {
      autoScoredJobId.current = jobId;
      if (runFit) forgetRunParam();
      // A run the user asked for (?run=fit) reports its result like a click; the
      // automatic upgrade of an estimate stays quiet.
      void handleScore({ silent: !runFit });
    }
    // Listing handleScore (defined inline, not memoised) would re-fire the effect
    // on every render; the autoScoredJobId ref is the real once-per-job guard. The
    // effect only reads jobId/autoScore/runFit, so those are the deps we declare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScore, runFit, jobId]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void handleScore()} disabled={isScoring} className="gap-1.5">
          <Target className="size-4" />
          {isScoring ? 'Scoring…' : 'Score fit'}
        </Button>
      </div>
      {/* Always present, so a screen reader hears the run start (#355). */}
      <p role="status" className="text-muted-foreground text-sm empty:hidden">
        {isScoring ? 'Scoring this job. It takes a few seconds.' : ''}
      </p>
      {failure ? (
        <ErrorState title="Couldn't score this job" message={failure} onRetry={() => void handleScore()} />
      ) : null}
    </div>
  );
}

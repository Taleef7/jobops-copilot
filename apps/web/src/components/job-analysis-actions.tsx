'use client';

import { Target } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ApiRequestError, scoreFit } from '@/lib/api';

type JobAnalysisActionsProps = {
  jobId: string;
};

// "Score fit" is the single analysis action: it parses the job and scores the
// fit in one step, then persists the scored analysis. (The old "Parse job"
// button saved a fit-less heuristic that overwrote a good score — removed.)
export function JobAnalysisActions({ jobId }: JobAnalysisActionsProps) {
  const router = useRouter();
  const [isScoring, setIsScoring] = useState(false);

  async function handleScore() {
    setIsScoring(true);
    try {
      const scored = await scoreFit({ jobId });
      toast.success(`Fit score saved: ${scored.fit_score}/100`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Failed to score the fit.');
    } finally {
      setIsScoring(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={handleScore} disabled={isScoring} className="gap-1.5">
        <Target className="size-4" />
        {isScoring ? 'Scoring…' : 'Score fit'}
      </Button>
    </div>
  );
}

'use client';

import { Sparkles, Target } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ApiRequestError, parseJob, scoreFit } from '@/lib/api';

type JobAnalysisActionsProps = {
  jobId: string;
  descriptionText: string;
};

export function JobAnalysisActions({ jobId, descriptionText }: JobAnalysisActionsProps) {
  const router = useRouter();
  const [isParsing, setIsParsing] = useState(false);
  const [isScoring, setIsScoring] = useState(false);

  async function handleParse() {
    setIsParsing(true);
    try {
      const parsed = await parseJob({ jobId, descriptionText });
      toast.success(parsed.title ? `Parsed: ${parsed.title}` : 'Parsed job description');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Failed to parse the job.');
    } finally {
      setIsParsing(false);
    }
  }

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

  const busy = isParsing || isScoring;

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={handleParse} disabled={busy} className="gap-1.5">
        <Sparkles className="size-4" />
        {isParsing ? 'Parsing…' : 'Parse job'}
      </Button>
      <Button onClick={handleScore} disabled={busy} className="gap-1.5">
        <Target className="size-4" />
        {isScoring ? 'Scoring…' : 'Score fit'}
      </Button>
    </div>
  );
}

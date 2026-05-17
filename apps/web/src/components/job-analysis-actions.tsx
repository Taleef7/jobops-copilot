'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, parseJob, scoreFit } from '@/lib/api';

type JobAnalysisActionsProps = {
  jobId: string;
  descriptionText: string;
  resumeText: string;
  profileText: string;
};

export function JobAnalysisActions({
  jobId,
  descriptionText,
  resumeText,
  profileText,
}: JobAnalysisActionsProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isScoring, setIsScoring] = useState(false);

  async function handleParse() {
    setError(null);
    setMessage(null);
    setIsParsing(true);

    try {
      const parsed = await parseJob({
        jobId,
        descriptionText,
      });

      setMessage(
        parsed.title
          ? `Parsed job description for ${parsed.title}. The analysis row has been refreshed.`
          : 'Parsed job description and refreshed the analysis row.',
      );
      router.refresh();
    } catch (requestError) {
      if (requestError instanceof ApiRequestError) {
        setError(requestError.message);
      } else {
        setError(requestError instanceof Error ? requestError.message : 'Failed to parse the job.');
      }
    } finally {
      setIsParsing(false);
    }
  }

  async function handleScore() {
    setError(null);
    setMessage(null);
    setIsScoring(true);

    try {
      const scored = await scoreFit({
        jobId,
        resumeText,
        profileText,
      });

      setMessage(`Fit score saved at ${scored.fit_score}. The job analysis has been refreshed.`);
      router.refresh();
    } catch (requestError) {
      if (requestError instanceof ApiRequestError) {
        setError(requestError.message);
      } else {
        setError(requestError instanceof Error ? requestError.message : 'Failed to score the fit.');
      }
    } finally {
      setIsScoring(false);
    }
  }

  return (
    <div className="stack">
      <p className="callout__text">
        Parse the description first, then score the fit using the built-in demo resume snapshot.
      </p>

      {message ? (
        <div className="callout">
          <p className="callout__title">Analysis updated</p>
          <p className="callout__text">{message}</p>
        </div>
      ) : null}

      {error ? (
        <div className="callout callout--accent">
          <p className="callout__title">Analysis failed</p>
          <p className="callout__text">{error}</p>
        </div>
      ) : null}

      <div className="hero__actions">
        <button className="button button--ghost" type="button" onClick={handleParse} disabled={isParsing || isScoring}>
          {isParsing ? 'Parsing...' : 'Parse job'}
        </button>
        <button className="button button--primary" type="button" onClick={handleScore} disabled={isParsing || isScoring}>
          {isScoring ? 'Scoring...' : 'Score fit'}
        </button>
      </div>
    </div>
  );
}

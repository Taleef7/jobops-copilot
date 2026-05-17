'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, updateOutreach } from '@/lib/api';
import type { OutreachStatus } from '@/types/job';

type OutreachReviewActionsProps = {
  outreachId: string;
  currentStatus: OutreachStatus;
  disabled?: boolean;
};

export function OutreachReviewActions({
  outreachId,
  currentStatus,
  disabled = false,
}: OutreachReviewActionsProps) {
  const router = useRouter();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(status: OutreachStatus) {
    if (disabled) {
      return;
    }

    setError(null);
    setIsUpdating(true);

    try {
      await updateOutreach(outreachId, { status });
      router.refresh();
    } catch (requestError) {
      if (requestError instanceof ApiRequestError) {
        setError(requestError.message);
      } else {
        setError(requestError instanceof Error ? requestError.message : 'Failed to update the draft.');
      }
    } finally {
      setIsUpdating(false);
    }
  }

  if (currentStatus === 'sent' || currentStatus === 'skipped') {
    return (
      <div className="stack">
        {error ? (
          <div className="callout callout--accent">
            <p className="callout__title">Could not update draft</p>
            <p className="callout__text">{error}</p>
          </div>
        ) : null}
        <p className="table-copy">No further inbox actions are available for this draft.</p>
      </div>
    );
  }

  if (disabled) {
    return (
      <div className="stack">
        {error ? (
          <div className="callout callout--accent">
            <p className="callout__title">Could not update draft</p>
            <p className="callout__text">{error}</p>
          </div>
        ) : null}
        <div className="callout callout--accent">
          <p className="callout__title">Actions disabled</p>
          <p className="callout__text">
            The inbox is showing seed data right now, so review actions are read-only until the live
            backend is available.
          </p>
        </div>
        <p className="table-copy">Seed drafts stay visible for review, but they cannot be updated here.</p>
      </div>
    );
  }

  const showApprove = currentStatus === 'drafted';
  const showSend = currentStatus === 'approved';

  return (
    <div className="stack">
      {error ? (
        <div className="callout callout--accent">
          <p className="callout__title">Could not update draft</p>
          <p className="callout__text">{error}</p>
        </div>
      ) : null}

      <div className="hero__actions">
        {showApprove ? (
          <button
            className="button button--ghost"
            type="button"
            onClick={() => setStatus('approved')}
            disabled={disabled || isUpdating}
          >
            {isUpdating ? 'Updating...' : 'Approve'}
          </button>
        ) : null}
        {showSend ? (
          <button
            className="button button--primary"
            type="button"
            onClick={() => setStatus('sent')}
            disabled={disabled || isUpdating}
          >
            {isUpdating ? 'Updating...' : 'Mark sent'}
          </button>
        ) : null}
        <button
          className="button button--ghost"
          type="button"
          onClick={() => setStatus('skipped')}
          disabled={disabled || isUpdating}
        >
          {isUpdating ? 'Updating...' : 'Skip'}
        </button>
      </div>

      <p className="table-copy">
        Mark sent only after you manually send the message yourself. Nothing is auto-delivered here.
      </p>
    </div>
  );
}

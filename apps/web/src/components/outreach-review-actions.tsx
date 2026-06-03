'use client';

import { Check, Forward, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ApiRequestError, updateOutreach } from '@/lib/api';
import type { OutreachStatus } from '@/types/job';

export function OutreachReviewActions({
  outreachId,
  currentStatus,
  disabled = false,
}: {
  outreachId: string;
  currentStatus: OutreachStatus;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isUpdating, setIsUpdating] = useState(false);

  async function setStatus(status: OutreachStatus) {
    if (disabled) return;
    setIsUpdating(true);
    try {
      await updateOutreach(outreachId, { status });
      toast.success(`Marked ${status}.`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Failed to update the draft.');
    } finally {
      setIsUpdating(false);
    }
  }

  if (currentStatus === 'sent' || currentStatus === 'skipped') return null;
  if (disabled) {
    return <p className="text-muted-foreground text-xs">Read-only (seed data).</p>;
  }

  const showApprove = currentStatus === 'drafted';
  const showSend = currentStatus === 'approved';

  return (
    <div className="flex flex-wrap gap-1.5">
      {showApprove ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setStatus('approved')}
          disabled={isUpdating}
          className="gap-1"
        >
          <Check className="size-3.5" /> Approve
        </Button>
      ) : null}
      {showSend ? (
        <Button size="sm" onClick={() => setStatus('sent')} disabled={isUpdating} className="gap-1">
          <Forward className="size-3.5" /> Mark sent
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setStatus('skipped')}
        disabled={isUpdating}
        className="gap-1"
      >
        <X className="size-3.5" /> Skip
      </Button>
    </div>
  );
}

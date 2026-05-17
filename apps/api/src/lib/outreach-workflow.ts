import type { JobStatus, OutreachDraft } from '@/types';

export const OUTREACH_DRAFT_NEXT_ACTION = 'Review the outreach draft and approve or skip it manually.';
export const OUTREACH_SENT_NEXT_ACTION = 'Track the reply window and prepare a follow-up if needed.';

const protectedStatuses = new Set<JobStatus>(['interview', 'rejected', 'offer', 'archived']);

export function shouldPreserveJobStatus(status: JobStatus) {
  return protectedStatuses.has(status);
}

export function deriveOutreachJobUpdate(
  currentStatus: JobStatus,
  outreachDrafts: Array<Pick<OutreachDraft, 'status'>>,
): { status: JobStatus; nextAction: string } | null {
  if (shouldPreserveJobStatus(currentStatus)) {
    return null;
  }

  const hasSentDraft = outreachDrafts.some((draft) => draft.status === 'sent');

  return {
    status: hasSentDraft ? 'outreach_sent' : 'outreach_drafted',
    nextAction: hasSentDraft ? OUTREACH_SENT_NEXT_ACTION : OUTREACH_DRAFT_NEXT_ACTION,
  };
}

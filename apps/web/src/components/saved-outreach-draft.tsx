import { CoverLetterDownloadButton } from '@/components/cover-letter-download-button';
import { DraftLengthWarning } from '@/components/draft-length-warning';
import { StatusPill } from '@/components/status-pill';
import type { OutreachDraft } from '@/types/job';

/** A job's saved outreach draft, with its length warning (#354). */
export function SavedOutreachDraft({
  draft,
  company,
  candidateName,
}: {
  draft: OutreachDraft;
  company: string;
  candidateName?: string;
}) {
  return (
    <div className="bg-muted/40 space-y-2 rounded-lg p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {draft.contactName || 'Contact'} · {draft.contactRole || draft.messageType.replaceAll('_', ' ')}
        </p>
        <div className="flex items-center gap-2">
          {draft.messageType === 'cover_letter' ? (
            <CoverLetterDownloadButton outreachId={draft.id} company={company} candidateName={candidateName} />
          ) : null}
          <StatusPill status={draft.status} />
        </div>
      </div>
      <p className="text-sm whitespace-pre-wrap">{draft.draftText}</p>
      <DraftLengthWarning messageType={draft.messageType} text={draft.draftText} />
    </div>
  );
}

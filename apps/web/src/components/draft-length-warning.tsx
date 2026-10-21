import { draftLengthWarning } from '@/lib/outreach-limits';
import type { OutreachMessageType } from '@/types/job';

/** A visible note when a draft is too long for its channel (#354); nothing otherwise. */
export function DraftLengthWarning({ messageType, text }: { messageType: OutreachMessageType; text: string }) {
  const warning = draftLengthWarning(messageType, text);
  return warning ? <p className="text-xs text-amber-700 dark:text-amber-400">{warning}</p> : null;
}

import type { OutreachMessageType } from '@/types/job';

/** LinkedIn cuts a connection note at 300 characters, or 200 on a free account (#354). */
export const LINKEDIN_NOTE_LIMIT = 300;

/**
 * The warning for a draft too long for its channel, or null. Only a LinkedIn connection note
 * has a hard limit. Characters are counted as JS `.length` does (UTF-16 units), like LinkedIn.
 */
export function draftLengthWarning(messageType: OutreachMessageType, text: string): string | null {
  if (messageType !== 'linkedin_connection' || text.length <= LINKEDIN_NOTE_LIMIT) return null;
  return (
    `Over ${LINKEDIN_NOTE_LIMIT} characters (${text.length}). LinkedIn allows ${LINKEDIN_NOTE_LIMIT}, ` +
    'or 200 on a free account. Shorten it before sending.'
  );
}

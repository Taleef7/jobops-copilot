import { PRERANK_MODEL } from '@/lib/local-fit';

/**
 * The next action a job carries from creation, before anything has scored it.
 * Defined here (not inline in each store) so the derivation below can
 * recognise it — the two must never drift apart.
 */
export const UNSCORED_NEXT_ACTION = 'Run fit scoring to analyze this role.';

/** What replaces it once a real analysis lands. */
export const ANALYZED_NEXT_ACTION = 'Review the fit summary, then draft outreach.';

/**
 * The next action a job should carry after an analysis is saved, or `null` to
 * leave the existing one alone.
 *
 * Saving an analysis never touched `next_action`, so a job that had been
 * scored — sometimes repeatedly — still told you to "Run fit scoring to
 * analyze this role." The one column meant to say what to do next was
 * describing work already done.
 *
 * Two things it deliberately will not do:
 *
 * - Overwrite anything other than the untouched creation-time prompt. A next
 *   action the user wrote, or one a later workflow set (see
 *   deriveOutreachJobUpdate), is theirs to keep — scoring a role again must
 *   not rewind "Track the reply window" back to "Review the fit summary".
 * - Advance on a pre-rank. Discovery's keyword estimate is tagged
 *   `local-prerank` and is explicitly not a scoring run, so the prompt to
 *   actually score the role has to survive it.
 */
export function deriveAnalyzedNextAction(
  currentNextAction: string | null | undefined,
  modelUsed: string,
): string | null {
  if (modelUsed === PRERANK_MODEL) return null;
  if ((currentNextAction ?? '').trim() !== UNSCORED_NEXT_ACTION) return null;
  return ANALYZED_NEXT_ACTION;
}

/**
 * The last LLM canary result (#348), as one plain sentence for Settings: when the model
 * last answered a real call, or why it didn't.
 */
export interface LlmCanaryResult {
  ok: boolean;
  model: string | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
}

function ago(from: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function describeLlmCheck(
  canary: LlmCanaryResult | null | undefined,
  now: Date = new Date(),
): { ok: boolean | null; text: string } {
  if (!canary) return { ok: null, text: 'No model check has run yet.' };
  const when = ago(new Date(canary.checkedAt), now);
  if (canary.ok) {
    const took = typeof canary.latencyMs === 'number' ? ` (${(canary.latencyMs / 1000).toFixed(1)} s)` : '';
    return { ok: true, text: `Last model check passed ${when}${took}.` };
  }
  return { ok: false, text: `Last model check failed ${when}: ${canary.error ?? 'no reason given'}` };
}

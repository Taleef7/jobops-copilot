export type RecencyWindow = 'all' | '24h' | '3d' | '7d';

export const RECENCY_OPTIONS: ReadonlyArray<{ value: RecencyWindow; label: string }> = [
  { value: 'all', label: 'Any time' },
  { value: '24h', label: 'Last 24h' },
  { value: '3d', label: 'Last 3 days' },
  { value: '7d', label: 'Last 7 days' },
];

const WINDOW_MS: Record<Exclude<RecencyWindow, 'all'>, number> = {
  '24h': 24 * 3600_000,
  '3d': 3 * 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
};

/** The date a posting is ranked by: when it was posted, else when we discovered it. */
export function recencyDate(job: { datePosted?: string; discoveredAt?: string }): string | undefined {
  return job.datePosted ?? job.discoveredAt;
}

/** True when the job's effective date falls inside the window relative to `nowMs`. */
export function isWithinRecency(
  job: { datePosted?: string; discoveredAt?: string },
  window: RecencyWindow,
  nowMs: number,
): boolean {
  if (window === 'all') return true;
  const date = recencyDate(job);
  if (!date) return false;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return false;
  return t >= nowMs - WINDOW_MS[window];
}

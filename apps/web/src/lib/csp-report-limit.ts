/**
 * A cap on how many CSP violation lines `/api/csp-report` logs (#347). The endpoint is
 * public, so a flood of reports must not become a flood of log lines. Per instance, in
 * memory: past the cap, reports are counted and the count is logged once the next minute
 * starts.
 */
const LINES_PER_MINUTE = 60;
const WINDOW_MS = 60_000;

let windowStart = 0;
let logged = 0;
let dropped = 0;

/** Whether one more line may be logged now. `log` receives the dropped-count line when a new minute starts. */
export function takeCspReportLine(log: (line: string) => void): boolean {
  const now = Date.now();
  if (now - windowStart >= WINDOW_MS) {
    if (dropped > 0) log(`[csp-report] ${dropped} more report(s) dropped in the last minute`);
    windowStart = now;
    logged = 0;
    dropped = 0;
  }
  if (logged >= LINES_PER_MINUTE) {
    dropped += 1;
    return false;
  }
  logged += 1;
  return true;
}

/** Test seam. */
export function resetCspReportLimit(): void {
  windowStart = 0;
  logged = 0;
  dropped = 0;
}

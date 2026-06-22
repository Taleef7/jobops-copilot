import { fetchWeeklyReports } from '@/lib/api';
import type { WeeklyReport } from '@/types/job';

export interface WeeklyReportDataResult {
  reports: WeeklyReport[];
  source: 'api' | 'seed';
}

/**
 * Loads the user's persisted weekly reports for the history list. Returns an
 * empty list when there are none or the API is unreachable — never fabricated
 * demo reports (that was the source of the phantom 14/2/1/1 on new accounts).
 */
export async function loadWeeklyReports(): Promise<WeeklyReportDataResult> {
  try {
    return { reports: await fetchWeeklyReports(), source: 'api' };
  } catch {
    return { reports: [], source: 'seed' };
  }
}

import { fetchWeeklyReports } from '@/lib/api';
import { loadErrorMessage } from '@/lib/job-data';
import type { WeeklyReport } from '@/types/job';

export interface WeeklyReportDataResult {
  reports: WeeklyReport[];
  /** Why the reports couldn't be loaded; null when they were (#349). */
  error: string | null;
}

/**
 * Loads the user's persisted weekly reports for the history list. Never fabricated demo
 * reports (that was the source of the phantom 14/2/1/1 on new accounts).
 */
export async function loadWeeklyReports(): Promise<WeeklyReportDataResult> {
  try {
    return { reports: await fetchWeeklyReports(), error: null };
  } catch (error) {
    return { reports: [], error: loadErrorMessage(error) };
  }
}

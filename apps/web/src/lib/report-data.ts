import { ApiRequestError, fetchWeeklyReports } from '@/lib/api';
import { mockWeeklyReports } from '@/lib/mock-data';
import type { WeeklyReport } from '@/types/job';

export interface WeeklyReportDataResult {
  reports: WeeklyReport[];
  source: 'api' | 'seed';
}

export async function loadWeeklyReports(): Promise<WeeklyReportDataResult> {
  try {
    const reports = await fetchWeeklyReports();

    if (reports.length > 0) {
      return {
        reports,
        source: 'api',
      };
    }
  } catch (error) {
    if (!(error instanceof ApiRequestError)) {
      return {
        reports: mockWeeklyReports,
        source: 'seed',
      };
    }
  }

  return {
    reports: mockWeeklyReports,
    source: 'seed',
  };
}

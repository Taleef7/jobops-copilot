/**
 * Builds a daily activity time-series from the CRM and provides a local
 * fallback summary used when the Python telemetry/analysis service is offline.
 * The pipeline is framed as "telemetry": discovery/outreach events over time,
 * analyzed the same way vehicle sensor streams would be (trend, anomalies,
 * forecast) in the agent service.
 */

import type { JobRecord } from '@/types';

export interface ActivityPoint {
  date: string;
  discovered: number;
  outreach_drafted: number;
  outreach_sent: number;
}

export interface TelemetryInsights {
  metric: string;
  total: number;
  trend: string;
  moving_average_7d: number;
  anomaly_dates: string[];
  forecast_next: number;
  narrative: string;
  recommendations: string[];
  series_labels: string[];
  series_values: number[];
  llm_used: boolean;
}

function dayKey(iso?: string): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function buildActivitySeries(jobs: JobRecord[]): ActivityPoint[] {
  const byDate = new Map<string, ActivityPoint>();

  const bump = (date: string | null, field: 'discovered' | 'outreach_drafted' | 'outreach_sent') => {
    if (!date) {
      return;
    }
    const point = byDate.get(date) ?? { date, discovered: 0, outreach_drafted: 0, outreach_sent: 0 };
    point[field] += 1;
    byDate.set(date, point);
  };

  for (const job of jobs) {
    bump(dayKey(job.discoveredAt), 'discovered');
    for (const draft of job.outreach ?? []) {
      bump(dayKey(draft.createdAt), 'outreach_drafted');
      if (draft.sentAt) {
        bump(dayKey(draft.sentAt), 'outreach_sent');
      }
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Deterministic insights used when the agent service is unavailable. */
export function localTelemetryFallback(series: ActivityPoint[]): TelemetryInsights {
  const values = series.map((point) => point.discovered);
  const total = values.reduce((sum, value) => sum + value, 0);
  const n = values.length;

  let trend = 'flat';
  if (n >= 2) {
    const first = values[0] ?? 0;
    const last = values[n - 1] ?? 0;
    trend = last > first ? 'rising' : last < first ? 'falling' : 'flat';
  }
  const recent = values.slice(-7);
  const movingAverage = recent.length ? recent.reduce((sum, value) => sum + value, 0) / recent.length : 0;

  return {
    metric: 'jobs_discovered_per_day',
    total,
    trend,
    moving_average_7d: movingAverage,
    anomaly_dates: [],
    forecast_next: movingAverage,
    narrative: `Tracked ${total} discovery event(s) across ${n} active day(s); the recent trend is ${trend}.`,
    recommendations: ['Configure the agent service for AI-narrated, anomaly-aware telemetry insights.'],
    series_labels: series.map((point) => point.date),
    series_values: values,
    llm_used: false,
  };
}

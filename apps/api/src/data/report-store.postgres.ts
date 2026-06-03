import { randomUUID } from 'node:crypto';
import type { WeeklyReportRecord } from '@/types';
import { getPool } from '@/lib/postgres';
import { seedWeeklyReports } from '@/data/mock-store';

type WeeklyReportRow = {
  id: string;
  week_start: string;
  week_end: string;
  jobs_discovered: number;
  jobs_shortlisted: number;
  jobs_applied: number;
  outreach_drafted: number;
  outreach_sent: number;
  responses_received: number;
  interviews: number;
  common_missing_skills: unknown;
  recommendations: unknown;
  report_markdown: string;
  report_url: string | null;
  created_at: string;
};

function poolOrThrow() {
  const pool = getPool();

  if (!pool) {
    throw new Error('Postgres is not configured. Set DATABASE_URL to enable the database-backed store.');
  }

  return pool;
}

function toTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function mapReport(row: WeeklyReportRow): WeeklyReportRecord {
  return {
    id: row.id,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    jobsDiscovered: row.jobs_discovered,
    jobsShortlisted: row.jobs_shortlisted,
    jobsApplied: row.jobs_applied,
    outreachDrafted: row.outreach_drafted,
    outreachSent: row.outreach_sent,
    responsesReceived: row.responses_received,
    interviews: row.interviews,
    commonMissingSkills: toTextArray(row.common_missing_skills),
    recommendations: toTextArray(row.recommendations),
    reportMarkdown: row.report_markdown,
    reportUrl: row.report_url ?? undefined,
    createdAt: row.created_at,
  };
}

export async function listWeeklyReports(userId: string): Promise<WeeklyReportRecord[]> {
  const pool = poolOrThrow();

  const { rows } = await pool.query<WeeklyReportRow>(
    'select * from weekly_reports where user_id = $1 order by created_at desc, week_end desc, week_start desc',
    [userId],
  );

  return rows.map(mapReport);
}

export async function saveWeeklyReport(userId: string, report: WeeklyReportRecord): Promise<WeeklyReportRecord> {
  const pool = poolOrThrow();

  const { rows } = await pool.query<WeeklyReportRow>(
    `
      insert into weekly_reports (
        id,
        user_id,
        week_start,
        week_end,
        jobs_discovered,
        jobs_shortlisted,
        jobs_applied,
        outreach_drafted,
        outreach_sent,
        responses_received,
        interviews,
        common_missing_skills,
        recommendations,
        report_markdown,
        report_url,
        created_at
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16
      )
      on conflict (user_id, week_start, week_end) do update set
        jobs_discovered = excluded.jobs_discovered,
        jobs_shortlisted = excluded.jobs_shortlisted,
        jobs_applied = excluded.jobs_applied,
        outreach_drafted = excluded.outreach_drafted,
        outreach_sent = excluded.outreach_sent,
        responses_received = excluded.responses_received,
        interviews = excluded.interviews,
        common_missing_skills = excluded.common_missing_skills,
        recommendations = excluded.recommendations,
        report_markdown = excluded.report_markdown,
        report_url = excluded.report_url,
        created_at = excluded.created_at
      returning *
    `,
    [
      report.id,
      userId,
      report.weekStart,
      report.weekEnd,
      report.jobsDiscovered,
      report.jobsShortlisted,
      report.jobsApplied,
      report.outreachDrafted,
      report.outreachSent,
      report.responsesReceived,
      report.interviews,
      JSON.stringify(report.commonMissingSkills),
      JSON.stringify(report.recommendations),
      report.reportMarkdown,
      report.reportUrl ?? null,
      report.createdAt,
    ],
  );

  const savedReport = rows[0];
  if (!savedReport) {
    throw new Error('Failed to save weekly report');
  }

  return mapReport(savedReport);
}

export async function getLatestWeeklyReport(userId: string): Promise<WeeklyReportRecord | undefined> {
  const reports = await listWeeklyReports(userId);
  return reports[0];
}

export async function clearUserReports(userId: string): Promise<void> {
  const pool = poolOrThrow();
  await pool.query('delete from weekly_reports where user_id = $1', [userId]);
}

export async function seedDemoReports(userId: string): Promise<void> {
  await clearUserReports(userId);
  for (const report of seedWeeklyReports) {
    await saveWeeklyReport(userId, { ...report, id: randomUUID() });
  }
}

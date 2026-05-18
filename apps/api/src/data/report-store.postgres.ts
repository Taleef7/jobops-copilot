import type { PoolClient } from 'pg';
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

let readyPromise: Promise<void> | null = null;

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

async function ensureSeedData(client: PoolClient) {
  const { rows } = await client.query<{ count: string }>('select count(*)::text as count from weekly_reports');
  if (Number(rows[0]?.count ?? '0') > 0) {
    return;
  }

  for (const report of seedWeeklyReports) {
    await client.query(
      `
        insert into weekly_reports (
          id,
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
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15
        )
        on conflict (id) do update set
          week_start = excluded.week_start,
          week_end = excluded.week_end,
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
      `,
      [
        report.id,
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
  }
}

async function ensureReady() {
  if (readyPromise) {
    await readyPromise;
    return;
  }

  const pool = poolOrThrow();

  readyPromise = (async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await ensureSeedData(client);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  })();

  try {
    await readyPromise;
  } finally {
    readyPromise = null;
  }
}

export async function listWeeklyReports(): Promise<WeeklyReportRecord[]> {
  await ensureReady();
  const pool = poolOrThrow();

  const { rows } = await pool.query<WeeklyReportRow>(
    'select * from weekly_reports order by created_at desc, week_end desc, week_start desc',
  );

  return rows.map(mapReport);
}

export async function saveWeeklyReport(report: WeeklyReportRecord): Promise<WeeklyReportRecord> {
  await ensureReady();
  const pool = poolOrThrow();

  const { rows } = await pool.query<WeeklyReportRow>(
    `
      insert into weekly_reports (
        id,
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
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15
      )
      on conflict (week_start, week_end) do update set
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

export async function getLatestWeeklyReport(): Promise<WeeklyReportRecord | undefined> {
  const reports = await listWeeklyReports();
  return reports[0];
}

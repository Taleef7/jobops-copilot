import { randomUUID } from 'node:crypto';
import type { JobRecord, WeeklyReportBody, WeeklyReportRecord } from '@/types';

export interface WeeklyReportMetrics {
  jobs_discovered: number;
  jobs_shortlisted: number;
  jobs_applied: number;
  outreach_drafted: number;
  outreach_sent: number;
  responses_received: number;
  interviews: number;
}

export interface WeeklyReportResponse {
  summary: string;
  metrics: WeeklyReportMetrics;
  common_missing_skills: string[];
  recommended_next_actions: string[];
  report_markdown: string;
  report_id: string;
  created_at: string;
  report_url: string | null;
}

function startOfDayUtc(date: string) {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function endOfDayUtc(date: string) {
  return Date.parse(`${date}T23:59:59.999Z`);
}

function withinWindow(value: string | undefined, windowStart: number, windowEnd: number) {
  if (!value) {
    return false;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) && time >= windowStart && time <= windowEnd;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function countSkills(jobs: JobRecord[]) {
  const skillCounts = new Map<string, number>();

  for (const job of jobs) {
    for (const skill of job.analysis.missingSkills) {
      skillCounts.set(skill, (skillCounts.get(skill) ?? 0) + 1);
    }
  }

  return [...skillCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([skill]) => skill);
}

function buildRecommendations(metrics: WeeklyReportMetrics, commonMissingSkills: string[]) {
  if (
    metrics.jobs_discovered === 0 &&
    metrics.jobs_shortlisted === 0 &&
    metrics.jobs_applied === 0 &&
    metrics.outreach_drafted === 0 &&
    metrics.outreach_sent === 0 &&
    metrics.responses_received === 0 &&
    metrics.interviews === 0
  ) {
    return [
      'No jobs were discovered in this window, so focus on intake sources or widen the search pipeline.',
      'Keep one outreach draft ready for the next promising role.',
      'Capture a concrete proof point before the next report so the dashboard has fresh evidence to show.',
    ];
  }

  const recommendations = [
    metrics.jobs_applied < metrics.jobs_shortlisted
      ? 'Push more shortlisted roles into applications while the context is still fresh.'
      : 'Keep your application queue tight and continue following up on the strongest leads.',
    metrics.outreach_drafted > metrics.outreach_sent
      ? 'Review the drafted outreach and send or archive the items that are still waiting.'
      : 'Keep outreach drafts aligned to the most promising roles and contacts.',
    commonMissingSkills[0]
      ? `Add one truthful proof point for ${commonMissingSkills[0]} to reduce repeated screening friction.`
      : 'Capture one new proof point from this week so the next report has a stronger story to tell.',
  ];

  return unique(recommendations).slice(0, 3);
}

function renderMarkdown(
  weekStart: string,
  weekEnd: string,
  metrics: WeeklyReportMetrics,
  commonMissingSkills: string[],
  recommendations: string[],
) {
  const lines = [
    `# Weekly report`,
    ``,
    `Reporting window: ${weekStart} to ${weekEnd}`,
    ``,
    `## Snapshot`,
    `- Jobs discovered: ${metrics.jobs_discovered}`,
    `- Jobs shortlisted: ${metrics.jobs_shortlisted}`,
    `- Jobs applied: ${metrics.jobs_applied}`,
    `- Outreach drafted: ${metrics.outreach_drafted}`,
    `- Outreach sent: ${metrics.outreach_sent}`,
    `- Responses received: ${metrics.responses_received}`,
    `- Interviews: ${metrics.interviews}`,
    ``,
    `## Common missing skills`,
    commonMissingSkills.length > 0
      ? commonMissingSkills.map((skill) => `- ${skill}`)
      : ['- No repeated gaps surfaced in this snapshot.'],
    ``,
    `## Recommended next actions`,
    ...recommendations.map((item, index) => `${index + 1}. ${item}`),
    ``,
    `This report is drafted from the live CRM snapshot and should still be human-reviewed before sharing.`,
  ];

  return lines.flat().join('\n');
}

export function buildWeeklyReportRecord(
  jobs: JobRecord[],
  body: WeeklyReportBody,
  createdAt = new Date().toISOString(),
): WeeklyReportRecord {
  const windowStart = startOfDayUtc(body.week_start);
  const windowEnd = endOfDayUtc(body.week_end);
  const jobsInWindow = jobs.filter((job) => withinWindow(job.discoveredAt, windowStart, windowEnd));
  const reportJobs = jobsInWindow;
  const jobOutreach = reportJobs.flatMap((job) => job.outreach);
  const shortlistedJobs = reportJobs.filter((job) => job.status === 'shortlisted');
  const appliedJobs = reportJobs.filter((job) => job.status === 'applied');
  const outreachDrafts = jobOutreach.filter(
    (draft) => draft.status === 'drafted' || draft.status === 'approved',
  );
  const outreachSent = jobOutreach.filter((draft) => draft.status === 'sent' || Boolean(draft.sentAt));
  const responsesReceived = reportJobs.filter(
    (job) => job.status === 'interview' || job.status === 'offer',
  );
  const interviews = reportJobs.filter((job) => job.status === 'interview');
  const commonMissingSkills = countSkills(reportJobs).slice(0, 4);

  const metrics: WeeklyReportMetrics = {
    jobs_discovered: reportJobs.length,
    jobs_shortlisted: shortlistedJobs.length,
    jobs_applied: appliedJobs.length,
    outreach_drafted: outreachDrafts.length,
    outreach_sent: outreachSent.length,
    responses_received: responsesReceived.length,
    interviews: interviews.length,
  };

  const recommendations = buildRecommendations(metrics, commonMissingSkills);
  const reportMarkdown = renderMarkdown(
    body.week_start,
    body.week_end,
    metrics,
    commonMissingSkills,
    recommendations,
  );

  return {
    id: randomUUID(),
    weekStart: body.week_start,
    weekEnd: body.week_end,
    jobsDiscovered: metrics.jobs_discovered,
    jobsShortlisted: metrics.jobs_shortlisted,
    jobsApplied: metrics.jobs_applied,
    outreachDrafted: metrics.outreach_drafted,
    outreachSent: metrics.outreach_sent,
    responsesReceived: metrics.responses_received,
    interviews: metrics.interviews,
    commonMissingSkills,
    recommendations,
    reportMarkdown,
    createdAt,
  };
}

export function formatWeeklyReportResponse(report: WeeklyReportRecord): WeeklyReportResponse {
  return {
    summary: `Weekly report draft for ${report.weekStart} through ${report.weekEnd}.`,
    metrics: {
      jobs_discovered: report.jobsDiscovered,
      jobs_shortlisted: report.jobsShortlisted,
      jobs_applied: report.jobsApplied,
      outreach_drafted: report.outreachDrafted,
      outreach_sent: report.outreachSent,
      responses_received: report.responsesReceived,
      interviews: report.interviews,
    },
    common_missing_skills: report.commonMissingSkills,
    recommended_next_actions: report.recommendations,
    report_markdown: report.reportMarkdown,
    report_id: report.id,
    created_at: report.createdAt,
    report_url: report.reportUrl ?? null,
  };
}

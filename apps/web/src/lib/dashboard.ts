import type { Job, JobStatus } from '@/types/job';

const statusBuckets: JobStatus[] = [
  'discovered',
  'shortlisted',
  'outreach_drafted',
  'outreach_sent',
  'referral_requested',
  'follow_up_due',
  'applied',
  'interview',
  'offer',
  'rejected',
  'archived',
];

export function getDashboardSummary(jobs: Job[]) {
  const averageFitScore = jobs.length
    ? Math.round(
        jobs.reduce((total, job) => total + (job.fitScore ?? 0), 0) / jobs.length,
      )
    : 0;

  const statusCounts = Object.fromEntries(
    statusBuckets.map((status) => [status, jobs.filter((job) => job.status === status).length]),
  ) as Record<JobStatus, number>;

  const missingSkills = new Map<string, number>();

  for (const job of jobs) {
    for (const skill of job.analysis.missingSkills) {
      missingSkills.set(skill, (missingSkills.get(skill) ?? 0) + 1);
    }
  }

  const topMissingSkills = [...missingSkills.entries()]
    .map(([skill, count]) => ({ skill, count }))
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
    .slice(0, 5);

  const followUpsDue = jobs.filter((job) => job.status === 'follow_up_due').length;
  const outreachDrafts = jobs.reduce((total, job) => total + job.outreach.length, 0);

  return {
    totalJobs: jobs.length,
    averageFitScore,
    statusCounts,
    followUpsDue,
    outreachDrafts,
    topMissingSkills,
  };
}

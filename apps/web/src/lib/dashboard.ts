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
  // Average only the jobs that actually carry a score. Counting an unscored job
  // as 0 dragged the headline number toward zero as soon as discovery pulled in
  // a batch — it reported "avg fit 32" for a pipeline whose scored jobs averaged
  // in the 80s. `null` means "not scored yet", never "scored zero".
  const scoredJobs = jobs.filter(
    (job): job is Job & { fitScore: number } => typeof job.fitScore === 'number',
  );
  const averageFitScore = scoredJobs.length
    ? Math.round(scoredJobs.reduce((total, job) => total + job.fitScore, 0) / scoredJobs.length)
    : null;
  const scoredJobCount = scoredJobs.length;

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
    scoredJobCount,
    statusCounts,
    followUpsDue,
    outreachDrafts,
    topMissingSkills,
  };
}

import type { Job } from '@/types/job';

/**
 * A live weekly-report snapshot derived from the user's REAL pipeline.
 *
 * Reports used to fall back to hardcoded demo numbers (14/2/1/1) for every new
 * account; this computes the figures from actual jobs instead, mirroring how the
 * dashboard aggregates so the two always reconcile.
 */
export interface ReportSnapshot {
  discovered: number;
  applied: number;
  outreachSent: number;
  interviews: number;
  /** Recurring missing skills across the pipeline, ranked by frequency (most common first). */
  commonMissingSkills: string[];
  /** Honest, data-derived guidance. Empty when there is no pipeline yet. */
  recommendations: string[];
}

function buildRecommendations(input: {
  hasJobs: boolean;
  applied: number;
  shortlisted: number;
  outreachDrafted: number;
  outreachSent: number;
  topSkill: string | undefined;
}): string[] {
  if (!input.hasJobs) return [];

  return [
    input.applied < input.shortlisted
      ? 'Push more shortlisted roles into applications while the context is still fresh.'
      : 'Keep following up on your strongest leads and active applications.',
    input.outreachDrafted > input.outreachSent
      ? 'Review your drafted outreach and send or archive what is still waiting.'
      : 'Keep your outreach aligned to the most promising roles and contacts.',
    input.topSkill
      ? `Add one truthful proof point for ${input.topSkill} to reduce repeated screening friction.`
      : 'Capture one new proof point this week so your next report has a stronger story.',
  ];
}

export function getReportSnapshot(jobs: Job[]): ReportSnapshot {
  const discovered = jobs.length;
  const applied = jobs.filter((job) => job.status === 'applied').length;
  const interviews = jobs.filter((job) => job.status === 'interview').length;
  const shortlisted = jobs.filter((job) => job.status === 'shortlisted').length;

  const drafts = jobs.flatMap((job) => job.outreach);
  const outreachSent = drafts.filter((draft) => draft.status === 'sent' || Boolean(draft.sentAt)).length;
  const outreachDrafted = drafts.filter(
    (draft) => draft.status === 'drafted' || draft.status === 'approved',
  ).length;

  const skillCounts = new Map<string, number>();
  for (const job of jobs) {
    for (const skill of job.analysis.missingSkills) {
      const key = skill.trim();
      if (!key) continue;
      skillCounts.set(key, (skillCounts.get(key) ?? 0) + 1);
    }
  }
  const commonMissingSkills = [...skillCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([skill]) => skill);

  const recommendations = buildRecommendations({
    hasJobs: discovered > 0,
    applied,
    shortlisted,
    outreachDrafted,
    outreachSent,
    topSkill: commonMissingSkills[0],
  });

  return { discovered, applied, outreachSent, interviews, commonMissingSkills, recommendations };
}

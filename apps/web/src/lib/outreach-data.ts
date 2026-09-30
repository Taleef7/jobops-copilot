import { loadJobs } from '@/lib/job-data';
import type { Job, OutreachDraft } from '@/types/job';

export interface OutreachInboxItem {
  jobId: string;
  company: string;
  title: string;
  jobStatus: Job['status'];
  priority: Job['priority'];
  draft: OutreachDraft;
}

export interface OutreachDataResult {
  items: OutreachInboxItem[];
  /** Why the drafts couldn't be loaded; null when they were (#349). */
  error: string | null;
}

export async function loadOutreach(): Promise<OutreachDataResult> {
  const { jobs, error } = await loadJobs();
  const items = jobs
    .flatMap((job) =>
      job.outreach.map((draft) => ({
        jobId: job.id,
        company: job.company,
        title: job.title,
        jobStatus: job.status,
        priority: job.priority,
        draft,
      })),
    )
    .sort((a, b) => new Date(b.draft.createdAt).getTime() - new Date(a.draft.createdAt).getTime());

  return { items, error };
}

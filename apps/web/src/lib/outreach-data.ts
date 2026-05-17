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
  source: 'api' | 'seed';
}

export async function loadOutreach(): Promise<OutreachDataResult> {
  const { jobs, source } = await loadJobs();
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

  return {
    items,
    source,
  };
}

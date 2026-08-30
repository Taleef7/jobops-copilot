import { fetchJobPage, type FetchDeps } from '@/lib/job-url-fetch';
import { extractJobFromHtml } from '@/lib/job-url-extract';
import type { SourcedJob } from '@/lib/job-sources';

export const FULL_JD_MIN_CHARS = 600;

export interface JdUpgradeResult {
  job: SourcedJob;
  upgraded: boolean;
}

export async function upgradeToFullJd(job: SourcedJob, deps: FetchDeps = {}): Promise<JdUpgradeResult> {
  try {
    const current = job.descriptionText ?? '';
    if (!job.jobUrl || current.length >= FULL_JD_MIN_CHARS) return { job, upgraded: false };
    const page = await fetchJobPage(job.jobUrl, deps);
    if (!page.html) return { job, upgraded: false };
    const extracted = extractJobFromHtml(page.html);
    const fullText = extracted.descriptionText?.trim() ?? '';
    if (fullText.length <= current.length * 1.5 || fullText.length < FULL_JD_MIN_CHARS) {
      return { job, upgraded: false };
    }
    return { job: { ...job, descriptionText: fullText }, upgraded: true };
  } catch {
    return { job, upgraded: false };
  }
}

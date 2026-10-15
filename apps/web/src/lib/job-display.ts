import type { Job, WorkplaceType } from '@/types/job';

export function isDuplicateRemote(location: string, workplaceType: WorkplaceType | null): boolean {
  return location.trim().toLowerCase() === 'remote' && workplaceType === 'remote';
}

/** "Company · Location" for a list row, or the company alone when the job states no location (#355). */
export function companyAndLocation(job: Pick<Job, 'company' | 'location'>): string {
  const location = job.location.trim();
  return location ? `${job.company} · ${location}` : job.company;
}

/**
 * The posting's address, when it is a web page to open (#353). The API accepts any URL,
 * so `javascript:` and other schemes are not linked. Written out in full: on an http page,
 * a browser reads `http:evil.com` as a path on the app.
 */
export function postingHref(jobUrl: string | undefined): string | null {
  if (!jobUrl) return null;
  try {
    const url = new URL(jobUrl);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

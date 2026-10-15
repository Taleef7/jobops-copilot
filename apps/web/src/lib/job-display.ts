import type { WorkplaceType } from '@/types/job';

export function isDuplicateRemote(location: string, workplaceType: WorkplaceType): boolean {
  return location.trim().toLowerCase() === 'remote' && workplaceType === 'remote';
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

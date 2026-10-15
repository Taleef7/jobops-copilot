import type { WorkplaceType } from '@/types/job';

export function isDuplicateRemote(location: string, workplaceType: WorkplaceType): boolean {
  return location.trim().toLowerCase() === 'remote' && workplaceType === 'remote';
}

/**
 * The posting's address, when it is a web page to open (#353). The API accepts any URL,
 * so `javascript:` and other schemes are not linked.
 */
export function postingHref(jobUrl: string | undefined): string | null {
  if (!jobUrl) return null;
  try {
    const { protocol } = new URL(jobUrl);
    return protocol === 'https:' || protocol === 'http:' ? jobUrl : null;
  } catch {
    return null;
  }
}

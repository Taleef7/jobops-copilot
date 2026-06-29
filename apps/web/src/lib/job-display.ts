import type { WorkplaceType } from '@/types/job';

export function isDuplicateRemote(location: string, workplaceType: WorkplaceType): boolean {
  return location.trim().toLowerCase() === 'remote' && workplaceType === 'remote';
}

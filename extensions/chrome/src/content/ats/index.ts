import type { AtsAdapter } from '../types';
import { ashbyAdapter } from './ashby';
import { greenhouseAdapter } from './greenhouse';
import { leverAdapter } from './lever';
import { workdayAdapter } from './workday';

export const ATS_ADAPTERS: AtsAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  workdayAdapter,
];

export function resolveAtsAdapter(url: string, document: Document): AtsAdapter | null {
  for (const adapter of ATS_ADAPTERS) {
    if (adapter.matches(url, document)) {
      return adapter;
    }
  }
  return null;
}

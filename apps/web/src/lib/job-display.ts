import type { Job, WorkplaceType } from '@/types/job';

export function isDuplicateRemote(location: string, workplaceType: WorkplaceType | null): boolean {
  return location.trim().toLowerCase() === 'remote' && workplaceType === 'remote';
}

const CURRENCY_SIGNS: Record<string, string> = { USD: '$', GBP: '£', EUR: '€' };

/**
 * A salary as the store saves it, written out in full with its basis and currency:
 * "£80,000 – £95,000 a year (GBP)", "From $90,000 a year (USD)" (#355).
 */
export function salaryAsSaved(salary: { min: number | null; max: number | null; currency: string }): string | null {
  const sign = CURRENCY_SIGNS[salary.currency] ?? '';
  const amount = (value: number) => `${sign}${value.toLocaleString('en-US')}`;
  const { min, max } = salary;
  let figure: string | null = null;
  if (min != null && max != null) figure = min === max ? amount(min) : `${amount(min)} – ${amount(max)}`;
  else if (min != null) figure = `From ${amount(min)}`;
  else if (max != null) figure = `Up to ${amount(max)}`;
  return figure ? `${figure} a year (${salary.currency})` : null;
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

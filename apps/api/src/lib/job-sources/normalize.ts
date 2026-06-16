import type { CreateJobBody } from '@/types';

/** A job from an external source, shaped for `createJob`, tagged with its origin. */
export type SourcedJob = CreateJobBody & { source: string };

/** Raw Adzuna `/search` result (only the fields we use). */
export interface AdzunaRaw {
  redirect_url?: string;
  title?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  description?: string;
  created?: string;
  contract_time?: string;
}

/** Raw Remotive `/remote-jobs` result (only the fields we use). */
export interface RemotiveRaw {
  url?: string;
  title?: string;
  company_name?: string;
  candidate_required_location?: string;
  description?: string;
  publication_date?: string;
  job_type?: string;
}

function clean(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/** Map a source's free-form employment string to the app's display labels. */
function employmentLabel(raw: unknown): string {
  const value = clean(raw).toLowerCase();
  if (value.includes('part')) return 'Part-time';
  if (value.includes('contract')) return 'Contract';
  if (value.includes('intern')) return 'Internship';
  return 'Full-time';
}

export function normalizeAdzuna(raw: AdzunaRaw): SourcedJob {
  return {
    jobUrl: clean(raw.redirect_url) || undefined,
    source: 'adzuna',
    company: clean(raw.company?.display_name, 'Unknown'),
    title: clean(raw.title, 'Untitled role'),
    location: clean(raw.location?.display_name),
    employmentType: employmentLabel(raw.contract_time),
    datePosted: clean(raw.created) || undefined,
    descriptionText: clean(raw.description),
  };
}

export function normalizeRemotive(raw: RemotiveRaw): SourcedJob {
  return {
    jobUrl: clean(raw.url) || undefined,
    source: 'remotive',
    company: clean(raw.company_name, 'Unknown'),
    title: clean(raw.title, 'Untitled role'),
    location: clean(raw.candidate_required_location, 'Remote'),
    employmentType: employmentLabel(raw.job_type),
    workplaceType: 'remote',
    datePosted: clean(raw.publication_date) || undefined,
    descriptionText: clean(raw.description),
  };
}

/**
 * Stable per-user dedup key: the canonical job URL when present, otherwise a
 * `company|title|location` fingerprint so URL-less postings still dedup.
 */
export function dedupKey(job: SourcedJob): string {
  if (job.jobUrl) return job.jobUrl.toLowerCase();
  return [job.company, job.title, job.location].map((part) => clean(part).toLowerCase()).join('|');
}

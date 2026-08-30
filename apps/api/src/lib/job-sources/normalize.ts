import type { CreateJobBody, JobWorkplaceType } from '@/types';

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
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string;
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

export function clean(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/** Map a source's free-form employment string to the app's display labels. */
export function employmentLabel(raw: unknown): string {
  const value = clean(raw).toLowerCase();
  if (value.includes('part')) return 'Part-time';
  if (value.includes('contract')) return 'Contract';
  if (value.includes('intern')) return 'Internship';
  return 'Full-time';
}

/**
 * Adzuna provides no workplace field. Infer it from the text, defaulting to
 * `onsite` — important because the job stores default an *omitted* workplaceType
 * to `remote`, which would mislabel physical-location roles.
 */
export function inferWorkplaceType(...fields: Array<string | undefined>): JobWorkplaceType {
  const text = fields.map((field) => clean(field).toLowerCase()).join(' ');
  if (text.includes('hybrid')) return 'hybrid';
  if (/\bremote\b|work from home|\bwfh\b/.test(text)) return 'remote';
  return 'onsite';
}

/**
 * Maps an Adzuna country code (e.g. `us`, `gb`, `ca`, `au`) to its currency code.
 * Falls back to `'USD'` for unmapped or unknown country codes.
 */
export function adzunaCountryCurrency(country: string): string {
  const map: Record<string, string> = {
    us: 'USD',
    gb: 'GBP',
    ca: 'CAD',
    au: 'AUD',
    de: 'EUR',
    fr: 'EUR',
    nl: 'EUR',
    be: 'EUR',
    at: 'EUR',
    in: 'INR',
    sg: 'SGD',
    nz: 'NZD',
    za: 'ZAR',
    br: 'BRL',
    mx: 'MXN',
  };
  return map[country.toLowerCase()] ?? 'USD';
}

export function normalizeAdzuna(raw: AdzunaRaw, currency = 'USD'): SourcedJob {
  const hasSalary = typeof raw.salary_min === 'number' || typeof raw.salary_max === 'number';
  return {
    jobUrl: clean(raw.redirect_url) || undefined,
    source: 'adzuna',
    company: clean(raw.company?.display_name, 'Unknown'),
    title: clean(raw.title, 'Untitled role'),
    location: clean(raw.location?.display_name),
    employmentType: employmentLabel(raw.contract_time),
    workplaceType: inferWorkplaceType(raw.title, raw.location?.display_name, raw.description),
    datePosted: clean(raw.created) || undefined,
    descriptionText: clean(raw.description),
    salaryMin: typeof raw.salary_min === 'number' ? Math.round(raw.salary_min) : undefined,
    salaryMax: typeof raw.salary_max === 'number' ? Math.round(raw.salary_max) : undefined,
    salaryCurrency: hasSalary ? currency : undefined,
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
 * `company|title|location` fingerprint — the URL-less dedup fallback. Exposed
 * so callers can record it alongside the URL key for URL-backed jobs, letting a
 * posting collide with a URL-less copy of itself.
 */
export function fingerprintKey(job: {
  company?: string;
  title?: string;
  location?: string;
}): string {
  return [job.company, job.title, job.location].map((part) => clean(part).toLowerCase()).join('|');
}

/**
 * Stable per-user dedup key: the canonical job URL when present, otherwise the
 * `company|title|location` fingerprint so URL-less postings still dedup.
 */
export function dedupKey(job: SourcedJob): string {
  if (job.jobUrl) return job.jobUrl.toLowerCase();
  return fingerprintKey(job);
}

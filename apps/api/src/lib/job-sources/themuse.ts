import type { JobSeniority } from '@/types';
import { htmlToText } from './boards';
import {
  clean,
  employmentLabel,
  filterByQueryTerms,
  inferWorkplaceType,
  type SourcedJob,
} from './normalize';
import type { JobSearchOptions, JobSource } from './types';

const NON_GEOGRAPHIC = new Set(['remote', 'anywhere', 'worldwide', 'global']);

export interface TheMuseRawJob {
  id?: number | string;
  name?: string;
  type?: string;
  contents?: string;
  publication_date?: string;
  company?: { id?: number; name?: string; short_name?: string };
  locations?: Array<{ name?: string }>;
  levels?: Array<{ name?: string; short_name?: string }>;
  refs?: { landing_page?: string };
}

function mapSeniority(levelName?: string): JobSeniority {
  const norm = clean(levelName).toLowerCase();
  if (norm.includes('entry')) return 'junior';
  if (norm.includes('mid')) return 'mid';
  if (norm.includes('senior')) return 'senior';
  if (norm.includes('management') || norm.includes('director')) return 'lead';
  return 'unknown';
}

export function normalizeTheMuse(raw: TheMuseRawJob): SourcedJob {
  const descriptionText = raw.contents ? htmlToText(raw.contents) : '';
  const location = raw.locations?.[0]?.name ? clean(raw.locations[0].name) : undefined;
  const levelName = raw.levels?.[0]?.name;

  return {
    jobUrl: clean(raw.refs?.landing_page) || undefined,
    source: 'themuse',
    company: clean(raw.company?.name, 'Unknown'),
    title: clean(raw.name, 'Untitled role'),
    location,
    employmentType: employmentLabel(raw.type),
    workplaceType: inferWorkplaceType(raw.name, location, descriptionText),
    datePosted: clean(raw.publication_date) || undefined,
    descriptionText,
    seniority: mapSeniority(levelName),
  };
}

export function createTheMuseSource(): JobSource {
  return {
    name: 'themuse',
    async search(query: string, opts: JobSearchOptions = {}): Promise<SourcedJob[]> {
      const fetchPage = async (page: number): Promise<TheMuseRawJob[]> => {
        const url = new URL('https://www.themuse.com/api/public/jobs');
        url.searchParams.set('page', String(page));
        if (opts.location) {
          url.searchParams.set('location', opts.location);
        }
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) {
          throw new Error(`The Muse request failed: ${res.status}`);
        }
        const data = (await res.json()) as { results?: TheMuseRawJob[] };
        return data.results ?? [];
      };

      const [p0, p1] = await Promise.allSettled([fetchPage(0), fetchPage(1)]);
      if (p0.status === 'rejected' && p1.status === 'rejected') {
        throw p0.reason;
      }
      const rawJobs = [
        ...(p0.status === 'fulfilled' ? p0.value : []),
        ...(p1.status === 'fulfilled' ? p1.value : []),
      ];

      let jobs = rawJobs.map(normalizeTheMuse);

      if (query) {
        jobs = filterByQueryTerms(jobs, query);
      }

      const location = opts.location?.trim().toLowerCase();
      if (location && !NON_GEOGRAPHIC.has(location)) {
        jobs = jobs.filter((job) => (job.location ?? '').toLowerCase().includes(location));
      }

      return jobs.slice(0, opts.limit ?? 25);
    },
  };
}

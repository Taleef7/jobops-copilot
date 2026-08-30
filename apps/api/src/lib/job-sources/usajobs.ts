import type { JobWorkplaceType } from '@/types';
import {
  clean,
  employmentLabel,
  inferWorkplaceType,
  type SourcedJob,
} from './normalize';
import type { JobSearchOptions, JobSource } from './types';

export interface UsaJobsRemuneration {
  MinimumRange?: string | number;
  MaximumRange?: string | number;
  RateIntervalCode?: string;
  Description?: string;
}

export interface UsaJobsDescriptor {
  PositionTitle?: string;
  OrganizationName?: string;
  DepartmentName?: string;
  PositionLocationDisplay?: string;
  PositionURI?: string;
  PublicationStartDate?: string;
  PositionRemuneration?: UsaJobsRemuneration[];
  UserArea?: {
    Details?: {
      JobSummary?: string;
      MajorDuties?: string[] | string;
    };
  };
  QualificationSummary?: string;
}

export interface UsaJobsRaw {
  MatchedObjectId?: string;
  MatchedObjectDescriptor?: UsaJobsDescriptor;
  PositionTitle?: string;
  OrganizationName?: string;
  PositionLocationDisplay?: string;
  PositionURI?: string;
  PublicationStartDate?: string;
  PositionRemuneration?: UsaJobsRemuneration[];
  UserArea?: {
    Details?: {
      JobSummary?: string;
      MajorDuties?: string[] | string;
    };
  };
}

export function usaJobsConfigured(): boolean {
  return Boolean(process.env.USAJOBS_API_KEY?.trim() && process.env.USAJOBS_USER_AGENT?.trim());
}

export function normalizeUsaJobs(raw: UsaJobsRaw): SourcedJob {
  const desc = raw.MatchedObjectDescriptor ?? raw;

  const summary = clean(desc.UserArea?.Details?.JobSummary);
  const rawDuties = desc.UserArea?.Details?.MajorDuties;
  const duties = Array.isArray(rawDuties)
    ? rawDuties.map((d) => clean(d)).filter(Boolean).join('\n')
    : clean(rawDuties);
  const descriptionText = [summary, duties].filter(Boolean).join('\n\n');

  const locDisplay = clean(desc.PositionLocationDisplay);
  let workplaceType: JobWorkplaceType;
  if (/anywhere in the u\.?s\.?/i.test(locDisplay)) {
    workplaceType = 'remote';
  } else {
    workplaceType = inferWorkplaceType(desc.PositionTitle, desc.PositionLocationDisplay, descriptionText);
  }

  let salaryMin: number | undefined;
  let salaryMax: number | undefined;
  let salaryCurrency: string | undefined;

  const rem = desc.PositionRemuneration?.[0];
  if (rem) {
    const minStr = clean(rem.MinimumRange);
    const maxStr = clean(rem.MaximumRange);
    const rawMin = minStr ? Number(minStr) : NaN;
    const rawMax = maxStr ? Number(maxStr) : NaN;
    const isHourly = rem.RateIntervalCode?.toUpperCase() === 'PH';
    const multiplier = isHourly ? 2080 : 1;

    if (Number.isFinite(rawMin)) {
      salaryMin = Math.round(rawMin * multiplier);
    }
    if (Number.isFinite(rawMax)) {
      salaryMax = Math.round(rawMax * multiplier);
    }
    if (salaryMin !== undefined || salaryMax !== undefined) {
      salaryCurrency = 'USD';
    }
  }

  return {
    jobUrl: clean(desc.PositionURI) || undefined,
    source: 'usajobs',
    company: clean(desc.OrganizationName, 'Unknown'),
    title: clean(desc.PositionTitle, 'Untitled role'),
    location: locDisplay || undefined,
    employmentType: employmentLabel('Full-time'),
    workplaceType,
    datePosted: clean(desc.PublicationStartDate) || undefined,
    descriptionText,
    salaryMin,
    salaryMax,
    salaryCurrency,
  };
}

export function createUsaJobsSource(): JobSource {
  return {
    name: 'usajobs',
    async search(query: string, opts: JobSearchOptions = {}): Promise<SourcedJob[]> {
      const url = new URL('https://data.usajobs.gov/api/search');
      if (query) url.searchParams.set('Keyword', query);
      if (opts.location) url.searchParams.set('LocationName', opts.location);
      if (opts.remoteOnly) url.searchParams.set('RemoteIndicator', 'True');
      url.searchParams.set('ResultsPerPage', String(opts.limit ?? 25));

      const headers: Record<string, string> = {
        'Authorization-Key': process.env.USAJOBS_API_KEY ?? '',
        'User-Agent': process.env.USAJOBS_USER_AGENT ?? '',
        Host: 'data.usajobs.gov',
      };

      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        throw new Error(`USAJobs request failed: ${response.status}`);
      }

      const data = (await response.json()) as {
        SearchResult?: {
          SearchResultItems?: UsaJobsRaw[];
        };
      };

      const items = data.SearchResult?.SearchResultItems ?? [];
      return items.map(normalizeUsaJobs);
    },
  };
}

import { parse } from 'node-html-parser';
import { parseSalaryFromText } from '@/lib/job-enrich';
import type { TargetCompany } from '@/types';
import {
  clean,
  employmentLabel,
  inferWorkplaceType,
  type SourcedJob,
} from './normalize';

export const TOKEN_RE = /^[A-Za-z0-9._-]+$/;

export interface GreenhouseRawJob {
  id?: number | string;
  title?: string;
  absolute_url?: string;
  location?: { name?: string };
  content?: string;
  updated_at?: string;
  employment_type?: string;
}

export interface LeverRawPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number | string;
  categories?: {
    commitment?: string;
    location?: string;
    team?: string;
    workplaceType?: string;
  };
  description?: string;
  descriptionPlain?: string;
  lists?: Array<{
    text?: string;
    content?: string;
  }>;
  additional?: string;
  additionalPlain?: string;
}

export interface AshbyRawJob {
  id?: string;
  title?: string;
  department?: string;
  team?: string;
  isRemote?: boolean;
  location?: string;
  jobUrl?: string;
  applyUrl?: string;
  hostedUrl?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  description?: string;
  publishedAt?: string;
  compensation?: {
    compensationTierSummary?: string;
  };
  employmentType?: string;
  workplaceType?: string;
}

export function htmlToText(html: string): string {
  if (!html) return '';
  const unescaped = parse(html).textContent;
  return parse(unescaped).textContent.trim();
}

export function normalizeGreenhouse(raw: GreenhouseRawJob, company?: string): SourcedJob {
  const descriptionText = raw.content ? htmlToText(raw.content) : '';
  const salary = parseSalaryFromText(descriptionText);
  return {
    jobUrl: clean(raw.absolute_url) || undefined,
    source: 'greenhouse',
    company: clean(company, 'Unknown'),
    title: clean(raw.title, 'Untitled role'),
    location: clean(raw.location?.name),
    employmentType: employmentLabel(raw.employment_type),
    workplaceType: inferWorkplaceType(raw.title, raw.location?.name, descriptionText),
    datePosted: clean(raw.updated_at) || undefined,
    descriptionText,
    salaryMin: salary?.min ?? undefined,
    salaryMax: salary?.max ?? undefined,
    salaryCurrency: salary?.currency ?? undefined,
  };
}

export function normalizeLever(raw: LeverRawPosting, company?: string): SourcedJob {
  const parts: string[] = [];
  if (raw.description) {
    parts.push(htmlToText(raw.description));
  } else if (raw.descriptionPlain) {
    parts.push(clean(raw.descriptionPlain));
  }

  if (Array.isArray(raw.lists)) {
    for (const list of raw.lists) {
      const heading = clean(list.text);
      const content = list.content ? htmlToText(list.content) : '';
      const section = [heading, content].filter(Boolean).join('\n');
      if (section) parts.push(section);
    }
  }

  if (raw.additional) {
    parts.push(htmlToText(raw.additional));
  } else if (raw.additionalPlain) {
    parts.push(clean(raw.additionalPlain));
  }

  const descriptionText = parts.filter(Boolean).join('\n\n').trim();

  let datePosted: string | undefined;
  if (typeof raw.createdAt === 'number') {
    datePosted = new Date(raw.createdAt).toISOString();
  } else if (typeof raw.createdAt === 'string') {
    datePosted = clean(raw.createdAt) || undefined;
  }

  let workplaceType: SourcedJob['workplaceType'];
  const rawWorkplace = clean(raw.categories?.workplaceType).toLowerCase();
  if (rawWorkplace.includes('remote')) {
    workplaceType = 'remote';
  } else if (rawWorkplace.includes('hybrid')) {
    workplaceType = 'hybrid';
  } else if (rawWorkplace.includes('onsite') || rawWorkplace.includes('on-site')) {
    workplaceType = 'onsite';
  } else {
    workplaceType = inferWorkplaceType(raw.text, raw.categories?.location, descriptionText);
  }

  const salary = parseSalaryFromText(descriptionText);

  return {
    jobUrl: clean(raw.hostedUrl || raw.applyUrl) || undefined,
    source: 'lever',
    company: clean(company, 'Unknown'),
    title: clean(raw.text, 'Untitled role'),
    location: clean(raw.categories?.location),
    employmentType: employmentLabel(raw.categories?.commitment),
    workplaceType,
    datePosted,
    descriptionText,
    salaryMin: salary?.min ?? undefined,
    salaryMax: salary?.max ?? undefined,
    salaryCurrency: salary?.currency ?? undefined,
  };
}

export function normalizeAshby(raw: AshbyRawJob, company?: string): SourcedJob {
  const descriptionText = raw.descriptionHtml
    ? htmlToText(raw.descriptionHtml)
    : clean(raw.descriptionPlain || raw.description);

  let workplaceType: SourcedJob['workplaceType'];
  if (raw.isRemote === true) {
    workplaceType = 'remote';
  } else if (raw.workplaceType) {
    const wt = raw.workplaceType.toLowerCase();
    if (wt.includes('remote')) workplaceType = 'remote';
    else if (wt.includes('hybrid')) workplaceType = 'hybrid';
    else if (wt.includes('onsite') || wt.includes('inoffice') || wt.includes('on-site')) workplaceType = 'onsite';
    else workplaceType = inferWorkplaceType(raw.title, raw.location, descriptionText);
  } else {
    workplaceType = inferWorkplaceType(raw.title, raw.location, descriptionText);
  }

  const salary =
    (raw.compensation?.compensationTierSummary
      ? parseSalaryFromText(raw.compensation.compensationTierSummary)
      : null) ?? parseSalaryFromText(descriptionText);

  return {
    jobUrl: clean(raw.jobUrl || raw.applyUrl || raw.hostedUrl) || undefined,
    source: 'ashby',
    company: clean(company, 'Unknown'),
    title: clean(raw.title, 'Untitled role'),
    location: clean(raw.location),
    employmentType: employmentLabel(raw.employmentType),
    workplaceType,
    datePosted: clean(raw.publishedAt) || undefined,
    descriptionText,
    salaryMin: salary?.min ?? undefined,
    salaryMax: salary?.max ?? undefined,
    salaryCurrency: salary?.currency ?? undefined,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'JobOpsCopilot/1.0 (+board-watch)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Board request failed (${response.status}): ${url}`);
  }
  return (await response.json()) as T;
}

export async function fetchBoardJobs(target: TargetCompany): Promise<SourcedJob[]> {
  const token = target.boardToken?.trim();
  if (!token || !TOKEN_RE.test(token)) {
    throw new Error(`Invalid board token: ${token}`);
  }

  switch (target.boardType) {
    case 'greenhouse': {
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
      const data = await fetchJson<{ jobs?: GreenhouseRawJob[] }>(url);
      const jobs = Array.isArray(data) ? data : (data.jobs ?? []);
      return jobs.map((raw) => normalizeGreenhouse(raw, target.company));
    }
    case 'lever': {
      const url = `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`;
      const data = await fetchJson<LeverRawPosting[] | { data?: LeverRawPosting[] }>(url);
      const postings = Array.isArray(data) ? data : (data.data ?? []);
      return postings.map((raw) => normalizeLever(raw, target.company));
    }
    case 'ashby': {
      const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`;
      const data = await fetchJson<{ jobs?: AshbyRawJob[] } | AshbyRawJob[]>(url);
      const jobs = Array.isArray(data) ? data : (data.jobs ?? []);
      return jobs.map((raw) => normalizeAshby(raw, target.company));
    }
    default:
      throw new Error(`Unsupported board type: ${(target as TargetCompany).boardType}`);
  }
}

export async function fetchTargetCompanyBoards(targets: TargetCompany[]): Promise<SourcedJob[]> {
  const enabled = targets.filter((t) => t.enabled);
  const allJobs: SourcedJob[] = [];
  for (const target of enabled) {
    try {
      const jobs = await fetchBoardJobs(target);
      allJobs.push(...jobs);
    } catch (err) {
      console.warn(`Failed to fetch board jobs for ${target.company} (${target.boardType}):`, err);
    }
  }
  return allJobs;
}

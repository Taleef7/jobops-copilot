import { fetchJobPage, type FetchDeps } from '@/lib/job-url-fetch';
import { extractJobFromHtml, type ExtractedJob } from '@/lib/job-url-extract';
import type { SourcedJob } from '@/lib/job-sources';

export const FULL_JD_MIN_CHARS = 600;

export interface JdUpgradeOptions {
  timeoutMs?: number;
}

export interface JdUpgradeResult {
  job: SourcedJob;
  upgraded: boolean;
}

const BOT_OR_ERROR_INDICATORS = [
  'verify you are human',
  'captcha',
  'cloudflare',
  'please enable javascript',
  'access denied',
  'sign in to continue',
  'log in to your account',
  'job has expired',
  'job is no longer available',
  'position has been filled',
  'page not found',
  '404 not found',
];

const JOB_CONTENT_KEYWORDS = [
  'responsibilities',
  'qualifications',
  'requirements',
  'experience',
  'skills',
  'about the role',
  'what you will do',
  "what you'll do",
  'who you are',
  'benefits',
  'equal opportunity',
  'compensation',
];

export function isLikelyJobDescription(fullText: string, job: SourcedJob, source: ExtractedJob['source']): boolean {
  const lower = fullText.toLowerCase();

  for (const indicator of BOT_OR_ERROR_INDICATORS) {
    if (lower.includes(indicator)) return false;
  }

  // JSON-LD JobPosting is explicitly structured job posting data published by ATS boards
  if (source === 'jsonld') {
    return true;
  }

  // For heuristic / meta extraction, require job-specific content evidence
  const keywordMatches = JOB_CONTENT_KEYWORDS.filter((k) => lower.includes(k)).length;
  if (keywordMatches >= 2) return true;

  // Or check title and company token overlap (significant words >= 4 characters)
  const titleTokens = (job.title ?? '').toLowerCase().split(/\W+/).filter((w) => w.length >= 4);
  const companyTokens = (job.company ?? '').toLowerCase().split(/\W+/).filter((w) => w.length >= 4);
  const matchedTokens = [...titleTokens, ...companyTokens].filter((token) => lower.includes(token));
  if (matchedTokens.length >= 2) return true;

  return false;
}

export async function upgradeToFullJd(
  job: SourcedJob,
  deps: FetchDeps = {},
  options: JdUpgradeOptions = {},
): Promise<JdUpgradeResult> {
  try {
    const current = job.descriptionText ?? '';
    if (!job.jobUrl || current.length >= FULL_JD_MIN_CHARS) return { job, upgraded: false };

    let pagePromise = fetchJobPage(job.jobUrl, deps);
    if (options.timeoutMs && options.timeoutMs > 0) {
      let timer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<{ html?: undefined; blocked: string }>((resolve) => {
        timer = setTimeout(() => resolve({ blocked: 'timeout' }), options.timeoutMs);
      });
      pagePromise = Promise.race([pagePromise, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    }

    const page = await pagePromise;
    if (!page.html) return { job, upgraded: false };
    const extracted = extractJobFromHtml(page.html);
    const fullText = extracted.descriptionText?.trim() ?? '';
    if (fullText.length <= current.length * 1.5 || fullText.length < FULL_JD_MIN_CHARS) {
      return { job, upgraded: false };
    }

    if (!isLikelyJobDescription(fullText, job, extracted.source)) {
      return { job, upgraded: false };
    }

    return { job: { ...job, descriptionText: fullText }, upgraded: true };
  } catch {
    return { job, upgraded: false };
  }
}

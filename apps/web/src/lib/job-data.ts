import { ApiRequestError, fetchJob, fetchJobs, fetchRankedFeed } from '@/lib/api';
import { mockJobs } from '@/lib/mock-data';
import type { FeedItem, FeedQueryOptions, FeedResult, Job } from '@/types/job';

export interface JobDataResult {
  jobs: Job[];
  source: 'api' | 'seed';
}

export interface JobResult {
  job: Job | undefined;
  source: 'api' | 'seed';
}

export interface FeedDataResult {
  feed: FeedResult;
  source: 'api' | 'seed';
}

function mockFeedResult(options: FeedQueryOptions = {}): FeedResult {
  let filtered = [...mockJobs];
  if (options.status) filtered = filtered.filter((j) => j.status === options.status);
  if (options.workplaceType) filtered = filtered.filter((j) => j.workplaceType === options.workplaceType);
  if (options.seniority) filtered = filtered.filter((j) => j.seniority === options.seniority);
  if (options.minScore != null) filtered = filtered.filter((j) => (j.fitScore ?? 0) >= (options.minScore ?? 0));

  const items: FeedItem[] = filtered.map((job) => {
    const subSignals = job.analysis.subSignals ?? {
      skills_match: job.fitScore ?? 75,
      title_seniority: job.seniority === 'senior' ? 85 : 75,
      salary_fit: 80,
      sponsorship_likelihood: job.sponsorLikelihood === 'likely' ? 90 : 60,
    };
    const rankReasons: string[] = [];
    if ((job.fitScore ?? 0) >= 85) rankReasons.push('Strong skill and domain alignment');
    if (job.workplaceType === 'remote') rankReasons.push('Remote opportunity');
    if (job.datePosted && Date.now() - new Date(job.datePosted).getTime() < 86_400_000 * 3) {
      rankReasons.push('Fresh posting (<72h)');
    }
    return {
      job,
      fitScore: job.fitScore,
      adjustedScore: job.fitScore,
      subSignals,
      rankReasons: rankReasons.length > 0 ? rankReasons : ['Matches current profile targets'],
    };
  });

  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}

export async function loadRankedFeed(options: FeedQueryOptions = {}): Promise<FeedDataResult> {
  try {
    return {
      feed: await fetchRankedFeed(options),
      source: 'api',
    };
  } catch {
    return {
      feed: mockFeedResult(options),
      source: 'seed',
    };
  }
}

export async function loadJobs(): Promise<JobDataResult> {
  try {
    return {
      jobs: await fetchJobs(),
      source: 'api',
    };
  } catch {
    return {
      jobs: mockJobs,
      source: 'seed',
    };
  }
}

export async function loadJob(jobId: string): Promise<JobResult> {
  try {
    return {
      job: await fetchJob(jobId),
      source: 'api',
    };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      return {
        job: mockJobs.find((candidate) => candidate.id === jobId),
        source: 'seed',
      };
    }

    return {
      job: mockJobs.find((candidate) => candidate.id === jobId),
      source: 'seed',
    };
  }
}

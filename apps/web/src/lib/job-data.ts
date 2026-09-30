import { ApiRequestError, fetchJob, fetchJobs, fetchRankedFeed } from '@/lib/api';
import type { FeedQueryOptions, FeedResult, Job } from '@/types/job';

/**
 * Server-side loaders for the pages. When the API fails, they return the reason (#349).
 * They used to return a local sample dataset instead, under a note that was easy to miss.
 */

export interface JobDataResult {
  jobs: Job[];
  /** Why the jobs couldn't be loaded; null when they were. */
  error: string | null;
}

export interface JobResult {
  /** Undefined when there is no such job, or when it couldn't be loaded (then `error` says why). */
  job: Job | undefined;
  error: string | null;
}

export interface FeedDataResult {
  feed: FeedResult | null;
  error: string | null;
}

/** The API's reason, or a plain one for a network failure. */
export function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return "The API couldn't be reached. Try again in a moment.";
}

export async function loadRankedFeed(options: FeedQueryOptions = {}): Promise<FeedDataResult> {
  try {
    return { feed: await fetchRankedFeed(options), error: null };
  } catch (error) {
    return { feed: null, error: loadErrorMessage(error) };
  }
}

export async function loadJobs(): Promise<JobDataResult> {
  try {
    return { jobs: await fetchJobs(), error: null };
  } catch (error) {
    return { jobs: [], error: loadErrorMessage(error) };
  }
}

export async function loadJob(jobId: string): Promise<JobResult> {
  try {
    return { job: await fetchJob(jobId), error: null };
  } catch (error) {
    // A job that doesn't exist is not a failure: the page shows its "not found".
    if (error instanceof ApiRequestError && error.status === 404) return { job: undefined, error: null };
    return { job: undefined, error: loadErrorMessage(error) };
  }
}

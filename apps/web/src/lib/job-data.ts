import { ApiRequestError, fetchJob, fetchJobs } from '@/lib/api';
import { mockJobs } from '@/lib/mock-data';
import type { Job } from '@/types/job';

export interface JobDataResult {
  jobs: Job[];
  source: 'api' | 'seed';
}

export interface JobResult {
  job: Job | undefined;
  source: 'api' | 'seed';
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

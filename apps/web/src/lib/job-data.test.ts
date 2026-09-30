import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchJobs, fetchJob, fetchRankedFeed } = vi.hoisted(() => ({
  fetchJobs: vi.fn(),
  fetchJob: vi.fn(),
  fetchRankedFeed: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  fetchJobs,
  fetchJob,
  fetchRankedFeed,
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));

import { ApiRequestError } from '@/lib/api';
import { loadJob, loadJobs, loadRankedFeed } from './job-data';

afterEach(() => vi.clearAllMocks());

// #349: when the API fails, pages get the reason, never sample jobs that look real.
describe('job data loaders', () => {
  it('return the jobs from the API', async () => {
    fetchJobs.mockResolvedValue([{ id: 'j1' }]);
    expect(await loadJobs()).toEqual({ jobs: [{ id: 'j1' }], error: null });
  });

  it('return the reason and no jobs when the API fails', async () => {
    fetchJobs.mockRejectedValue(new ApiRequestError('API unreachable', 502));
    expect(await loadJobs()).toEqual({ jobs: [], error: 'API unreachable' });
  });

  it('say the API could not be reached on a network failure', async () => {
    fetchJobs.mockRejectedValue(new TypeError('fetch failed'));
    expect(await loadJobs()).toEqual({ jobs: [], error: "The API couldn't be reached. Try again in a moment." });
  });

  it('treat a missing job as missing, not as an error', async () => {
    fetchJob.mockRejectedValue(new ApiRequestError('Job not found', 404));
    expect(await loadJob('nope')).toEqual({ job: undefined, error: null });
  });

  it('return the reason when one job fails to load', async () => {
    fetchJob.mockRejectedValue(new ApiRequestError('API unreachable', 502));
    expect(await loadJob('j1')).toEqual({ job: undefined, error: 'API unreachable' });
  });

  it('return no feed and the reason when the feed fails', async () => {
    fetchRankedFeed.mockRejectedValue(new ApiRequestError('The API took too long to answer.', 504));
    expect(await loadRankedFeed()).toEqual({ feed: null, error: 'The API took too long to answer.' });
  });
});

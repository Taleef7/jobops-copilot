import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';

const { loadJob, api } = vi.hoisted(() => ({
  loadJob: vi.fn(async (): Promise<{ job: unknown; error: string | null }> => ({ job: undefined, error: null })),
  api: {
    fetchProfile: vi.fn(async () => null),
    fetchAgentOutputs: vi.fn(async () => []),
    fetchJobResumeVersions: vi.fn(async () => []),
    fetchJobApplicationPack: vi.fn(async () => null),
    fetchJobContacts: vi.fn(async () => []),
  },
}));
vi.mock('@/lib/job-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/job-data')>()),
  loadJob,
}));
vi.mock('@/lib/api', () => api);
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import JobDetailPage, { generateMetadata } from './page';

afterEach(() => {
  vi.clearAllMocks();
});

const params = (jobId: string) => ({ params: Promise.resolve({ jobId }) });

// #353: `/jobs/not-a-real-id` asked the API for the job and its outputs, versions, pack and
// contacts, and took 12.5 s on live to say "not found". A job id is a UUID.
it('is not found for a malformed id, without asking the API', async () => {
  await expect(JobDetailPage(params('not-a-real-id'))).rejects.toThrow('NEXT_NOT_FOUND');

  expect(loadJob).not.toHaveBeenCalled();
  for (const fetcher of Object.values(api)) expect(fetcher).not.toHaveBeenCalled();
});

it('titles a malformed id without asking the API', async () => {
  expect(await generateMetadata(params('not-a-real-id'))).toEqual({ title: 'Job detail' });
  expect(loadJob).not.toHaveBeenCalled();
});

it('asks the API about a well-formed id, and is not found when there is no such job', async () => {
  await expect(JobDetailPage(params('7f1c2a9e-3b4d-4e5f-8a6b-0c1d2e3f4a5b'))).rejects.toThrow('NEXT_NOT_FOUND');
  expect(loadJob).toHaveBeenCalledWith('7f1c2a9e-3b4d-4e5f-8a6b-0c1d2e3f4a5b');
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, createJob, draftOutreach, fetchJobs, parseJob, scoreFit, uploadResumeFile } from './api';

// Under jsdom `window` is defined, so apiFetch routes through the same-origin
// Next proxy (`/api/proxy/*`). We mock global fetch and inspect the call.
function mockFetch(response: Partial<Response> & { json: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, ...response });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastBody(fetchMock: ReturnType<typeof vi.fn>) {
  const init = fetchMock.mock.calls[0]![1] as RequestInit;
  return JSON.parse(init.body as string);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('request mappers map camelCase payloads to the API snake_case shape', () => {
  it('scoreFit sends job_id and only includes resume_text/profile_text when provided', async () => {
    const fetchMock = mockFetch({ json: async () => ({ fit_score: 80 }) });
    await scoreFit({ jobId: 'job-1', resumeText: 'r' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/proxy/api/ai/score-fit');
    expect(init.method).toBe('POST');
    const body = lastBody(fetchMock);
    expect(body).toEqual({ job_id: 'job-1', resume_text: 'r' });
    expect(body).not.toHaveProperty('profile_text'); // omitted when absent
  });

  it('parseJob maps descriptionText -> description_text', async () => {
    const fetchMock = mockFetch({ json: async () => ({ summary: 'ok' }) });
    await parseJob({ jobId: 'job-2', descriptionText: 'Build agents' });
    expect(lastBody(fetchMock)).toEqual({ job_id: 'job-2', description_text: 'Build agents' });
  });

  it('draftOutreach maps the contact/context fields to snake_case', async () => {
    const fetchMock = mockFetch({ json: async () => ({ subject: 's' }) });
    await draftOutreach({
      jobId: 'job-3',
      messageType: 'recruiter_email',
      contactName: 'Ada',
      jobContext: 'ctx',
    });
    const body = lastBody(fetchMock);
    expect(body.message_type).toBe('recruiter_email');
    expect(body.contact_name).toBe('Ada');
    expect(body.job_context).toBe('ctx');
  });
});

describe('requestJson error handling', () => {
  it('throws ApiRequestError carrying the status, message, and field errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Bad input', fields: { descriptionText: 'required' } }),
      }),
    );

    await expect(parseJob({ descriptionText: '' })).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 400,
      message: 'Bad input',
      fields: { descriptionText: 'required' },
    });
  });

  it('keeps the id of the job a 409 points at (#346)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: 'You already added this job.',
          fields: { jobUrl: 'You already added this job.' },
          existingJobId: 'job-123',
        }),
      }),
    );

    await expect(
      createJob({ company: 'Stripe', title: 'Engineer', descriptionText: 'x', jobUrl: 'https://stripe.com/jobs?gh_jid=1' }),
    ).rejects.toMatchObject({ status: 409, existingJobId: 'job-123', fields: { jobUrl: 'You already added this job.' } });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      }),
    );

    await expect(scoreFit({ jobId: 'x' })).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('uploadResumeFile', () => {
  it("shows the API's reason when an upload is refused (#389)", async () => {
    mockFetch({
      ok: false,
      status: 415,
      json: async () => ({ error: 'Upload your résumé as a PDF, or paste its text.' }),
    });
    const file = new File(['not a pdf'], 'resume.pdf', { type: 'application/pdf' });
    const error = await uploadResumeFile(file).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).message).toBe('Upload your résumé as a PDF, or paste its text.');
    expect((error as ApiRequestError).status).toBe(415);
  });

  it('falls back to a plain message when the error has no body', async () => {
    mockFetch({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
    const error = await uploadResumeFile(new File(['x'], 'r.pdf')).catch((caught: unknown) => caught);
    expect((error as ApiRequestError).message).toBe('Failed to upload resume');
  });
});

// #349: a request that hangs or can't connect ends with a plain reason, not a spinner forever.
describe('requestJson timeouts and network failures', () => {
  it('gives plain API calls 30 seconds and AI calls longer than the server does', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    mockFetch({ json: async () => ({ jobs: [] }) });
    await fetchJobs();
    expect(timeout).toHaveBeenLastCalledWith(30_000);

    mockFetch({ json: async () => ({ fit_score: 80 }) });
    await scoreFit({ jobId: 'job-1' });
    // The API's own agent limit is 120 s; the client waits a little past it so the
    // API's answer (a 503 with the reason) arrives first.
    expect(timeout).toHaveBeenLastCalledWith(130_000);
    timeout.mockRestore();
  });

  it('says the API took too long when the request times out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('signal timed out', 'TimeoutError')));
    const error = await fetchJobs().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).message).toBe('The API took too long to answer. Try again in a moment.');
    expect((error as ApiRequestError).status).toBe(408);
  });

  it("says the API couldn't be reached on a network failure", async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await fetchJobs().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).message).toBe("The API couldn't be reached. Try again in a moment.");
    expect((error as ApiRequestError).status).toBe(0);
  });
});

describe('uploadResumeFile network failures', () => {
  it('says the API took too long when the upload times out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('signal timed out', 'TimeoutError')));
    const file = new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' });
    await expect(uploadResumeFile(file)).rejects.toThrow('The API took too long to answer. Try again in a moment.');
  });
});

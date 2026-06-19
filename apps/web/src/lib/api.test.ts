import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, draftOutreach, parseJob, scoreFit } from './api';

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
  vi.restoreAllMocks();
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

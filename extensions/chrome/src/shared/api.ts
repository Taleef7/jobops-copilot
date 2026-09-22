import type {
  CaptureApplicationPayload,
  CaptureApplicationResponse,
  MatchResponse,
  ProfileFillData,
  VerifyResponse,
} from '../types';

export class ExtensionApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'ExtensionApiError';
  }
}

function cleanBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function authHeaders(pat: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${pat.trim()}`,
  };
}

export async function verifyConnection(apiUrl: string, pat: string): Promise<VerifyResponse> {
  if (!pat.trim()) {
    return { ok: false, error: 'Personal access token is required' };
  }

  const base = cleanBaseUrl(apiUrl);
  try {
    const res = await fetch(`${base}/api/ext/verify`, {
      method: 'GET',
      headers: authHeaders(pat),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errorMsg = (data as any).error || `Verification failed with HTTP ${res.status}`;
      return { ok: false, error: errorMsg };
    }

    return data as VerifyResponse;
  } catch (err: any) {
    return { ok: false, error: err.message || 'Unable to connect to JobOps API' };
  }
}

export async function matchJobByUrl(apiUrl: string, pat: string, targetUrl: string): Promise<MatchResponse> {
  const base = cleanBaseUrl(apiUrl);
  const endpoint = `${base}/api/ext/match?url=${encodeURIComponent(targetUrl)}`;

  const res = await fetch(endpoint, {
    method: 'GET',
    headers: authHeaders(pat),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ExtensionApiError((data as any).error || 'Job match request failed', res.status, data);
  }

  return data as MatchResponse;
}

export async function getProfileFill(apiUrl: string, pat: string): Promise<ProfileFillData> {
  const base = cleanBaseUrl(apiUrl);
  const res = await fetch(`${base}/api/ext/profile-fill`, {
    method: 'GET',
    headers: authHeaders(pat),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ExtensionApiError((data as any).error || 'Profile fill fetch failed', res.status, data);
  }

  return data as ProfileFillData;
}

export async function captureApplication(
  apiUrl: string,
  pat: string,
  payload: CaptureApplicationPayload,
): Promise<CaptureApplicationResponse> {
  const base = cleanBaseUrl(apiUrl);
  const res = await fetch(`${base}/api/ext/applications`, {
    method: 'POST',
    headers: authHeaders(pat),
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ExtensionApiError((data as any).error || 'Application capture failed', res.status, data);
  }

  return data as CaptureApplicationResponse;
}

export async function saveAnswer(
  apiUrl: string,
  pat: string,
  questionText: string,
  answer: string,
  ats?: string,
): Promise<{ answer: any }> {
  const base = cleanBaseUrl(apiUrl);
  const res = await fetch(`${base}/api/ext/answers`, {
    method: 'POST',
    headers: authHeaders(pat),
    body: JSON.stringify({ questionText, answer, ats }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ExtensionApiError((data as any).error || 'Save answer failed', res.status, data);
  }

  return data as { answer: any };
}

import { isSingleRecipientEmailAddress } from '@/lib/email';

type GmailDraftStatus = 'created' | 'skipped' | 'failed';

export interface GmailDraftRequest {
  recipientEmail: string;
  subject: string;
  bodyText: string;
}

export interface GmailDraftResult {
  status: GmailDraftStatus;
  gmailDraftId?: string;
  message: string;
}

interface GmailTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GmailApiError {
  message?: string;
  code?: number;
  status?: string;
}

interface GmailCreateDraftResponse {
  id?: string;
  error?: GmailApiError | string;
  error_description?: string;
}

function isTruthy(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function normalizeBodyText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').join('\r\n');
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildMimeMessage({ recipientEmail, subject, bodyText }: GmailDraftRequest) {
  return [
    `To: ${sanitizeHeader(recipientEmail)}`,
    `Subject: ${sanitizeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    normalizeBodyText(bodyText),
    '',
  ].join('\r\n');
}

function extractGoogleErrorMessage(payload: GmailCreateDraftResponse | GmailTokenResponse, fallback: string) {
  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error.trim();
  }

  if (payload.error && typeof payload.error === 'object' && payload.error.message?.trim()) {
    return payload.error.message.trim();
  }

  if (payload.error_description?.trim()) {
    return payload.error_description.trim();
  }

  return fallback;
}

async function fetchAccessToken() {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();

  if (!clientId || !clientSecret || !refreshToken) {
    return undefined;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  let payload: GmailTokenResponse = {};
  try {
    payload = (await response.json()) as GmailTokenResponse;
  } catch {
    // Ignore non-JSON token responses and fall back to a generic error message.
  }

  if (!response.ok || !payload.access_token) {
    const message = extractGoogleErrorMessage(payload, `Google token request failed (${response.status})`);
    throw new Error(message);
  }

  return payload.access_token;
}

export async function createGmailDraftIfEnabled(
  request: GmailDraftRequest,
): Promise<GmailDraftResult> {
  if (!isTruthy(process.env.GMAIL_DRAFTS_ENABLED)) {
    return {
      status: 'skipped',
      message: 'Gmail draft support is disabled by feature flag.',
    };
  }

  if (!request.recipientEmail.trim()) {
    return {
      status: 'skipped',
      message: 'Recipient email is required to create a Gmail draft.',
    };
  }

  if (!isSingleRecipientEmailAddress(request.recipientEmail)) {
    return {
      status: 'skipped',
      message: 'Recipient email must be a single valid email address.',
    };
  }

  const accessToken = await fetchAccessToken();
  if (!accessToken) {
    return {
      status: 'skipped',
      message: 'Gmail OAuth credentials are not configured yet.',
    };
  }

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        raw: base64UrlEncode(buildMimeMessage(request)),
      },
    }),
  });

  let payload: GmailCreateDraftResponse = {};
  try {
    payload = (await response.json()) as GmailCreateDraftResponse;
  } catch {
    // Ignore non-JSON API responses and fall back to a generic failure message.
  }

  if (!response.ok || !payload.id) {
    const message = extractGoogleErrorMessage(
      payload,
      `Gmail draft creation failed (${response.status})`,
    );
    console.error('Gmail draft creation failed', {
      status: response.status,
      error: payload,
    });
    return {
      status: 'failed',
      message: `Gmail draft creation failed: ${message}`,
    };
  }

  return {
    status: 'created',
    gmailDraftId: payload.id,
    message: 'Gmail draft created in the connected mailbox.',
  };
}

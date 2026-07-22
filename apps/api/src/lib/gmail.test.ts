import assert from 'node:assert/strict';
import test from 'node:test';
import { createGmailDraftIfEnabled } from './gmail';

function snapshotEnv(keys: string[]) {
  const snapshot = new Map<string, string | undefined>();

  for (const key of keys) {
    snapshot.set(key, process.env[key]);
  }

  return () => {
    for (const [key, value] of snapshot) {
      if (typeof value === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

test('skips Gmail drafting when the feature flag is disabled', async () => {
  const restore = snapshotEnv([
    'GMAIL_DRAFTS_ENABLED',
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
    'GMAIL_REFRESH_TOKEN',
  ]);

  try {
    delete process.env.GMAIL_DRAFTS_ENABLED;
    const result = await createGmailDraftIfEnabled({
      recipientEmail: 'maya@example.com',
      subject: 'Hello',
      bodyText: 'Draft body',
    });

    assert.equal(result.status, 'skipped');
    assert.equal(result.message, 'Gmail draft support is disabled by feature flag.');
  } finally {
    restore();
  }
});

test('rejects multi-recipient email strings before contacting Google', async () => {
  const restore = snapshotEnv([
    'GMAIL_DRAFTS_ENABLED',
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
    'GMAIL_REFRESH_TOKEN',
  ]);
  const originalFetch = globalThis.fetch;

  try {
    process.env.GMAIL_DRAFTS_ENABLED = 'true';
    globalThis.fetch = (async () => {
      throw new Error('fetch should not be called for invalid recipient input');
    }) as typeof fetch;

    const result = await createGmailDraftIfEnabled({
      recipientEmail: 'maya@example.com, attacker@example.com',
      subject: 'Hello',
      bodyText: 'Draft body',
    });

    assert.equal(result.status, 'skipped');
    assert.equal(result.message, 'Recipient email must be a single valid email address.');
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('attaches an abort timeout signal to both Google fetches', async () => {
  const restore = snapshotEnv([
    'GMAIL_DRAFTS_ENABLED',
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
    'GMAIL_REFRESH_TOKEN',
  ]);
  const originalFetch = globalThis.fetch;
  const signals: Array<AbortSignal | undefined> = [];

  try {
    process.env.GMAIL_DRAFTS_ENABLED = 'true';
    process.env.GMAIL_CLIENT_ID = 'client-id';
    process.env.GMAIL_CLIENT_SECRET = 'client-secret';
    process.env.GMAIL_REFRESH_TOKEN = 'refresh-token';

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      signals.push((init?.signal as AbortSignal | null) ?? undefined);
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'access-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id: 'draft-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await createGmailDraftIfEnabled({
      recipientEmail: 'maya@example.com',
      subject: 'Hello',
      bodyText: 'Draft body',
    });

    assert.equal(result.status, 'created');
    assert.equal(signals.length, 2, 'both the token and draft fetches should run');
    for (const signal of signals) {
      assert.ok(signal instanceof AbortSignal, 'each Google fetch must carry an AbortSignal timeout');
    }
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('surfaces Gmail API error details and logs the rejection', async () => {
  const restore = snapshotEnv([
    'GMAIL_DRAFTS_ENABLED',
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
    'GMAIL_REFRESH_TOKEN',
  ]);
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const logs: Array<Parameters<typeof console.error>> = [];

  try {
    process.env.GMAIL_DRAFTS_ENABLED = 'true';
    process.env.GMAIL_CLIENT_ID = 'client-id';
    process.env.GMAIL_CLIENT_SECRET = 'client-secret';
    process.env.GMAIL_REFRESH_TOKEN = 'refresh-token';

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'access-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('gmail.googleapis.com/gmail/v1/users/me/drafts')) {
        return new Response(
          JSON.stringify({
            error: {
              message: 'Quota exceeded',
              code: 403,
              status: 'PERMISSION_DENIED',
            },
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    console.error = ((...args: Parameters<typeof console.error>) => {
      logs.push(args);
    }) as typeof console.error;

    const result = await createGmailDraftIfEnabled({
      recipientEmail: 'maya@example.com',
      subject: 'Hello',
      bodyText: 'Draft body',
    });

    assert.equal(result.status, 'failed');
    assert.match(result.message, /Quota exceeded/);
    assert.ok(logs.some((entry) => String(entry[0]) === 'Gmail draft creation failed'));
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    restore();
  }
});

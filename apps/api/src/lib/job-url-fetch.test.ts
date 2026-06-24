import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJobFromUrl, fetchJobPage } from './job-url-fetch';

const okSafe = async (raw: string) => ({ ok: true as const, url: new URL(raw) });

function htmlResponse(body: string, contentType = 'text/html; charset=utf-8', status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

test('fetchJobPage returns html for a safe, html, 200 page', async () => {
  const page = await fetchJobPage('https://example.com/job', {
    assertSafe: okSafe,
    fetchImpl: async () => htmlResponse('<html><body>hi</body></html>'),
  });
  assert.equal(page.blocked, undefined);
  assert.match(page.html ?? '', /hi/);
});

test('fetchJobPage allows a response with no content-type header', async () => {
  // A Uint8Array body does not get an auto content-type (unlike a string body),
  // so this exercises the missing-header path.
  const page = await fetchJobPage('https://example.com/job', {
    assertSafe: okSafe,
    fetchImpl: async () =>
      new Response(new TextEncoder().encode('<html><body>ok</body></html>'), { status: 200 }),
  });
  assert.equal(page.blocked, undefined);
  assert.match(page.html ?? '', /ok/);
});

test('fetchJobPage blocks a non-html response', async () => {
  const page = await fetchJobPage('https://example.com/x.pdf', {
    assertSafe: okSafe,
    fetchImpl: async () => htmlResponse('%PDF', 'application/pdf'),
  });
  assert.notEqual(page.blocked, undefined);
  assert.equal(page.html, undefined);
});

test('fetchJobPage surfaces an SSRF rejection', async () => {
  const page = await fetchJobPage('http://169.254.169.254/', {
    assertSafe: async () => ({ ok: false as const, reason: 'blocked range' }),
    fetchImpl: async () => htmlResponse('should not be reached'),
  });
  assert.equal(page.blocked, 'blocked range');
});

test('fetchJobPage re-validates a redirect target', async () => {
  let calls = 0;
  const page = await fetchJobPage('https://example.com/start', {
    assertSafe: async (raw) =>
      raw.includes('internal')
        ? { ok: false as const, reason: 'redirect blocked' }
        : { ok: true as const, url: new URL(raw) },
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: 'http://internal.local/' } });
    },
  });
  assert.equal(page.blocked, 'redirect blocked');
  assert.equal(calls, 1);
});

test('fetchJobPage blocks a body over the 2 MB cap', async () => {
  const big = 'x'.repeat(2_000_001);
  const page = await fetchJobPage('https://example.com/big', {
    assertSafe: okSafe,
    fetchImpl: async () => htmlResponse(big),
  });
  assert.equal(page.blocked, 'That page is too large to read.');
  assert.equal(page.html, undefined);
});

test('fetchJobPage blocks when the fetch throws (timeout/network)', async () => {
  const page = await fetchJobPage('https://example.com/slow', {
    assertSafe: okSafe,
    fetchImpl: async () => {
      throw new DOMException('timed out', 'TimeoutError');
    },
  });
  assert.equal(page.blocked, 'Could not reach that page.');
});

test('fetchJobPage stops after too many redirects', async () => {
  let n = 0;
  const page = await fetchJobPage('https://example.com/r', {
    assertSafe: okSafe,
    fetchImpl: async () => {
      n += 1;
      return new Response(null, { status: 302, headers: { location: `https://example.com/r${n}` } });
    },
  });
  assert.equal(page.blocked, 'Too many redirects.');
});

test('extractJobFromUrl maps a fetched page', async () => {
  const result = await extractJobFromUrl('https://example.com/job', {
    fetchPage: async () => ({
      html: '<html><head><meta property="og:title" content="Mapped Role"></head><body></body></html>',
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.data.title, 'Mapped Role');
});

test('extractJobFromUrl returns the block reason as an error', async () => {
  const result = await extractJobFromUrl('http://10.0.0.1/', {
    fetchPage: async () => ({ blocked: 'private address' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, 'private address');
});

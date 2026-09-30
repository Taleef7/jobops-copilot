import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import { POST } from './route';

afterEach(() => {
  vi.restoreAllMocks();
});

// #347: the report-only CSP sends its violations here, so the policy can be enforced once
// two weeks pass without any. Only the directive, the blocked origin and the page path are
// logged: a full URL can carry tokens.
function report(body: unknown, contentType = 'application/csp-report') {
  return new NextRequest('http://localhost:3000/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

it('logs a classic csp-report as one trimmed line', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  const response = await POST(
    report({
      'csp-report': {
        'document-uri': 'https://jobops-web.azurewebsites.net/jobs/abc?token=secret',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://cdn.evil.example/x.js?session=secret',
      },
    }),
  );

  expect(response.status).toBe(204);
  expect(warn).toHaveBeenCalledTimes(1);
  const line = String(warn.mock.calls[0]![0]);
  expect(line).toBe('[csp-report] script-src-elem blocked=https://cdn.evil.example page=/jobs/abc');
  expect(line).not.toContain('secret');
});

it('logs each violation in a Reporting API batch', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  const response = await POST(
    report(
      [
        { type: 'csp-violation', body: { documentURL: 'https://app.example/settings', effectiveDirective: 'img-src', blockedURL: 'data' } },
        { type: 'deprecation', body: {} },
      ],
      'application/reports+json',
    ),
  );

  expect(response.status).toBe(204);
  expect(warn.mock.calls.map((call) => String(call[0]))).toEqual(['[csp-report] img-src blocked=data page=/settings']);
});

it('ignores junk and refuses a body over 16 KB', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  expect((await POST(report('not json'))).status).toBe(204);
  expect((await POST(report('x'.repeat(17 * 1024)))).status).toBe(413);
  expect(warn).not.toHaveBeenCalled();
});

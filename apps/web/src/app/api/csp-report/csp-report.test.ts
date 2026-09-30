import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetCspReportLimit } from '@/lib/csp-report-limit';
import { POST } from './route';

beforeEach(() => {
  resetCspReportLimit();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// #347: the report-only CSP sends its violations here, so the policy can be enforced once
// two weeks pass without any. Only the directive, the blocked origin and the page path are
// logged: a full URL can carry tokens. The endpoint is public, so it logs only reports about
// this app's own pages, in the content types browsers send, at a bounded rate.
const APP = 'http://localhost:3000';

function report(body: unknown, contentType = 'application/csp-report') {
  return new NextRequest(`${APP}/api/csp-report`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const classic = (page: string, directive = 'img-src', blocked = 'data') => ({
  'csp-report': { 'document-uri': page, 'effective-directive': directive, 'blocked-uri': blocked },
});

it('logs a classic csp-report as one trimmed line', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  const response = await POST(
    report(classic(`${APP}/jobs/abc?token=secret`, 'script-src-elem', 'https://cdn.evil.example/x.js?session=secret')),
  );

  expect(response.status).toBe(204);
  expect(warn).toHaveBeenCalledTimes(1);
  const line = String(warn.mock.calls[0]![0]);
  expect(line).toBe('[csp-report] script-src-elem blocked=https://cdn.evil.example page=/jobs/abc');
  expect(line).not.toContain('secret');
});

it('logs each violation in a Reporting API batch, at most five per request', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const violation = { type: 'csp-violation', body: { documentURL: `${APP}/settings`, effectiveDirective: 'img-src', blockedURL: 'data' } };

  const response = await POST(report([violation, { type: 'deprecation', body: {} }, ...Array(9).fill(violation)], 'application/reports+json'));

  expect(response.status).toBe(204);
  expect(warn.mock.calls.map((call) => String(call[0]))).toEqual(Array(5).fill('[csp-report] img-src blocked=data page=/settings'));
});

it('ignores reports about other sites’ pages, which could point their own CSP here', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  expect((await POST(report(classic('https://evil.example/page')))).status).toBe(204);
  expect(warn).not.toHaveBeenCalled();
});

it('refuses other content types, so a no-CORS text/plain post logs nothing', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  expect((await POST(report(classic(`${APP}/`), 'text/plain'))).status).toBe(415);
  expect(warn).not.toHaveBeenCalled();
});

it('logs at most 60 lines a minute, then says how many it dropped', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-30T00:00:00Z'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  for (let i = 0; i < 70; i += 1) await POST(report(classic(`${APP}/p${i}`)));
  expect(warn).toHaveBeenCalledTimes(60);

  vi.setSystemTime(new Date('2026-09-30T00:01:01Z'));
  await POST(report(classic(`${APP}/later`)));
  expect(warn.mock.calls.slice(60).map((call) => String(call[0]))).toEqual([
    '[csp-report] 10 more report(s) dropped in the last minute',
    '[csp-report] img-src blocked=data page=/later',
  ]);
});

it('ignores junk and refuses a body over 16 KB', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  expect((await POST(report('not json'))).status).toBe(204);
  expect((await POST(report('x'.repeat(17 * 1024)))).status).toBe(413);
  expect(warn).not.toHaveBeenCalled();
});

import { expect, it } from 'vitest';
import nextConfig from '../next.config';

// #347: every page carries the security headers, and none says what it runs on.
async function headersFor(source: string) {
  const rules = (await nextConfig.headers?.()) ?? [];
  const rule = rules.find((entry) => entry.source === source);
  return new Map((rule?.headers ?? []).map((header) => [header.key.toLowerCase(), header.value]));
}

it('does not advertise Next.js', () => {
  expect(nextConfig.poweredByHeader).toBe(false);
});

it('sends the security headers on every route', async () => {
  const headers = await headersFor('/(.*)');

  expect(headers.get('strict-transport-security')).toBe('max-age=63072000; includeSubDomains');
  expect(headers.get('x-frame-options')).toBe('DENY');
  expect(headers.get('x-content-type-options')).toBe('nosniff');
  expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  expect(headers.get('permissions-policy')).toBe('camera=(), geolocation=(), microphone=()');
});

it('enforces a minimal CSP: no framing, no plugins, no base-tag hijack', async () => {
  const csp = (await headersFor('/(.*)')).get('content-security-policy') ?? '';

  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
});

it('reports, without enforcing yet, the full policy Clerk needs', async () => {
  const csp = (await headersFor('/(.*)')).get('content-security-policy-report-only') ?? '';
  const directive = (name: string) => csp.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? '';

  expect(directive('default-src')).toContain("'self'");
  expect(directive('script-src')).toContain('https://*.clerk.accounts.dev');
  expect(directive('script-src')).toContain('https://challenges.cloudflare.com');
  expect(directive('connect-src')).toContain('https://*.clerk.accounts.dev');
  expect(directive('img-src')).toContain('https://img.clerk.com');
  expect(directive('frame-src')).toContain('https://challenges.cloudflare.com');
  expect(directive('worker-src')).toBe("worker-src 'self' blob:");
  expect(directive('report-uri')).toBe('report-uri /api/csp-report');
});

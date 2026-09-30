import path from 'node:path';
import type { NextConfig } from 'next';

// Enforced now (#347): nothing may frame the app, load plugins or re-point relative URLs.
const ENFORCED_CSP = ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"].join('; ');

// The full policy, reported but not enforced until it has run clean for two weeks (#347).
// Clerk's Frontend API is the development instance's host until S01 moves live auth off it;
// Cloudflare's challenge runs on Clerk's sign-up. Violations go to /api/csp-report.
const REPORTED_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev https://challenges.cloudflare.com",
  "connect-src 'self' https://*.clerk.accounts.dev https://clerk-telemetry.com",
  "img-src 'self' data: blob: https://img.clerk.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "frame-src 'self' https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  'report-uri /api/csp-report',
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Nothing in the app uses the camera, location or microphone.
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=()' },
  { key: 'Content-Security-Policy', value: ENFORCED_CSP },
  { key: 'Content-Security-Policy-Report-Only', value: REPORTED_CSP },
];

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle for Azure App Service.
  output: 'standalone',
  // In this npm-workspaces monorepo, dependencies are hoisted to the repo root,
  // so widen the file-tracing root past apps/web to include them.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  // Keep applicationinsights as a Node.js external so Turbopack/webpack never
  // tries to bundle its dynamic-require internals (mysql, etc.).
  serverExternalPackages: ['applicationinsights'],
  // Clerk-hosted avatars (the single source of identity — Phase 6).
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'img.clerk.com' }],
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;

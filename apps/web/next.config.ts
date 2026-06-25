import path from 'node:path';
import type { NextConfig } from 'next';

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
};

export default nextConfig;

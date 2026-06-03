import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle for Azure App Service.
  output: 'standalone',
  // In this npm-workspaces monorepo, dependencies are hoisted to the repo root,
  // so widen the file-tracing root past apps/web to include them.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
};

export default nextConfig;

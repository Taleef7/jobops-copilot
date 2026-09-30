import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { isProxyPathAllowed } from './allowed-paths';

// #347: every API path the browser calls must be on the proxy's allowlist, so a new client
// call can't silently 404. Paths are read from the source: string and template literals
// that start with /api/. A `${…}` after a "/" stands for one path segment; anywhere else it
// appends a query string, which is dropped.
const SRC = join(__dirname, '..', '..', '..');
const CALLERS = [
  'lib/api.ts',
  'app/(app)/reports/page.tsx',
  'components/settings-actions.tsx',
  'components/assistant-panel.tsx',
];

function clientPaths(): string[] {
  const paths = new Set<string>();
  for (const file of CALLERS) {
    const source = readFileSync(join(SRC, file), 'utf8');
    for (const match of source.matchAll(/[`'"](\/api\/[^`'"\s]*)/g)) {
      let path = match[1]!
        .replace(/\/\$\{[^}]*\}/g, '/x')
        .replace(/\$\{[^}]*\}.*$/, '')
        .replace(/[?#].*$/, '');
      if (path === '/api/proxy' || path.includes('*')) continue; // apiFetch's prefix, and comments
      path = path.replace(/^\/api\/proxy(?=\/)/, '');
      if (path.startsWith('/api/assistant-')) continue; // their own route handlers, not the proxy
      paths.add(path);
    }
  }
  return [...paths].sort();
}

const segments = (path: string) => path.split('/').filter(Boolean);

it('finds the client calls it checks', () => {
  const paths = clientPaths();
  expect(paths.length).toBeGreaterThan(30);
  expect(paths).toContain('/api/jobs');
  expect(paths).toContain('/api/reports/x/export');
  expect(paths).toContain('/api/ai/assistant/resume');
  expect(paths).toContain('/api/profile/export');
});

it('allows every path the web client calls', () => {
  expect(clientPaths().filter((path) => !isProxyPathAllowed(segments(path)))).toEqual([]);
});

it('blocks machine-only and removed routes', () => {
  for (const path of ['/internal/discovery/run', '/api/n8n/job-intake', '/api/ext/verify', '/api/ext-tokens', '/api/health', '/api/jobs/../internal']) {
    expect(isProxyPathAllowed(segments(path)), path).toBe(false);
  }
});

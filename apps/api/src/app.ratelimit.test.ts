import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type express from 'express';

async function withApp(app: express.Express, run: (baseUrl: string) => Promise<void>) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Test server did not provide a usable address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('the strict limiter caps the AI routes (429) while other routes stay open', async () => {
  // Set before importing the app so the limiter modules pick up the small limit.
  process.env.RATE_LIMIT_AI_MAX = '2';
  process.env.RATE_LIMIT_MAX = '1000';
  const { createApp } = await import('@/app');
  const app = createApp();

  // The AI routes reserve budget against the file-mode usage store; isolate its
  // `data/` artifact in a temp cwd so the suite stays clean.
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-ratelimit-'));
  process.chdir(tempDir);
  try {
    await withApp(app, async (baseUrl) => {
      const hit = () => fetch(`${baseUrl}/api/ai/none`, { headers: { 'X-User-Id': 'u_strict' } });
      assert.notEqual((await hit()).status, 429);
      assert.notEqual((await hit()).status, 429);
      assert.equal((await hit()).status, 429);

      // A non-AI route under the same user is not blocked by the strict bucket.
      const health = await fetch(`${baseUrl}/api/health`, { headers: { 'X-User-Id': 'u_strict' } });
      assert.notEqual(health.status, 429);
    });
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

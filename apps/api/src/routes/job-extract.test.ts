import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createJobExtractRouter } from './job-extract';
import type { ExtractResult } from '@/lib/job-url-fetch';

async function withServer(
  mount: (app: express.Express) => void,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    const header = request.header('X-User-Id');
    if (header) request.userId = header.trim();
    next();
  });
  mount(app);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('no server address');
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function mountExtract(extract: (url: string) => Promise<ExtractResult>) {
  return (app: express.Express) => app.use('/api/jobs/extract', createJobExtractRouter({ extract }));
}

test('POST /api/jobs/extract requires a signed-in user', async () => {
  await withServer(mountExtract(async () => ({ ok: true, data: { source: 'none' } })), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/jobs/extract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://x/y' }),
    });
    assert.equal(response.status, 401);
  });
});

test('POST /api/jobs/extract returns extracted fields', async () => {
  await withServer(
    mountExtract(async () => ({ ok: true, data: { title: 'AI Engineer', source: 'jsonld' } })),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/jobs/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-User-Id': 'u1' },
        body: JSON.stringify({ url: 'https://x/y' }),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { title: string; source: string };
      assert.equal(body.title, 'AI Engineer');
      assert.equal(body.source, 'jsonld');
    },
  );
});

test('POST /api/jobs/extract returns 400 for a blocked URL', async () => {
  await withServer(
    mountExtract(async () => ({ ok: false, error: 'private address' })),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/jobs/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-User-Id': 'u1' },
        body: JSON.stringify({ url: 'http://10.0.0.1/' }),
      });
      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string };
      assert.equal(body.error, 'private address');
    },
  );
});

test('POST /api/jobs/extract returns 400 when url is missing', async () => {
  await withServer(mountExtract(async () => ({ ok: true, data: { source: 'none' } })), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/jobs/extract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-User-Id': 'u1' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
  });
});

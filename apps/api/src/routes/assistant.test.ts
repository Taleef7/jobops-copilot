import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createAssistantStreamRouter } from './assistant';
import { AgentDisabledError } from '@/lib/agent-client';

function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

async function withServer(
  router: ReturnType<typeof createAssistantStreamRouter>,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    const header = request.header('X-User-Id');
    if (header) request.userId = header.trim();
    next();
  });
  app.use('/stream', router);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Test server did not provide a usable address');
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('pipes upstream SSE frames through unbuffered', async () => {
  const router = createAssistantStreamRouter({
    openUpstream: async () => ({
      ok: true,
      status: 200,
      body: sseStream([
        'event: status\ndata: {"node": "parse"}\n\n',
        'event: awaiting_approval\ndata: {"thread_id": "t1"}\n\n',
      ]),
    }),
  });
  await withServer(router, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'u1' },
      body: JSON.stringify({ description_text: 'Build agents' }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const text = await res.text();
    assert.ok(text.includes('event: status') && text.includes('"node": "parse"'));
    assert.ok(text.includes('event: awaiting_approval'));
  });
});

test('requires a signed-in user', async () => {
  const router = createAssistantStreamRouter({
    openUpstream: async () => ({ ok: true, status: 200, body: sseStream([]) }),
  });
  await withServer(router, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description_text: 'd' }),
    });
    assert.equal(res.status, 401);
  });
});

test('requires description_text', async () => {
  const router = createAssistantStreamRouter({
    openUpstream: async () => ({ ok: true, status: 200, body: sseStream([]) }),
  });
  await withServer(router, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'u1' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});

test('returns 503 (not 500) when the agent service is disabled', async () => {
  const router = createAssistantStreamRouter({
    openUpstream: async () => {
      throw new AgentDisabledError();
    },
  });
  await withServer(router, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'u1' },
      body: JSON.stringify({ description_text: 'd' }),
    });
    assert.equal(res.status, 503);
  });
});

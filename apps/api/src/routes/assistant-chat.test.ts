import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createAssistantChatRouter } from './assistant-chat';
import type { JobRecord } from '@/types';

function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

function fakeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-1',
    source: 'manual',
    company: 'Acme',
    title: 'Staff Engineer',
    location: 'Remote',
    employmentType: 'full_time',
    workplaceType: 'remote',
    discoveredAt: '2026-06-01T00:00:00.000Z',
    descriptionText: 'Build distributed systems.',
    status: 'discovered',
    priority: 'medium',
    fitScore: 82,
    analysis: {
      requiredSkills: [],
      preferredSkills: [],
      matchedSkills: ['Go', 'Kubernetes'],
      missingSkills: ['Rust'],
      atsKeywords: [],
      fitSummary: 'Strong systems match.',
      recommendedResumeAngle: '',
      applyRecommendation: 'apply',
      confidenceScore: 0.8,
      modelUsed: 'test',
    },
    outreach: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

async function withServer(
  router: ReturnType<typeof createAssistantChatRouter>,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    const header = request.header('X-User-Id');
    if (header) request.userId = header.trim();
    next();
  });
  app.use('/chat', router);

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

const okStream = async () => ({ ok: true, status: 200, body: sseStream(['event: done\ndata: {}\n\n']) });

test('pipes upstream token frames through unbuffered', async () => {
  const router = createAssistantChatRouter({
    getJob: async () => undefined,
    openUpstream: async () => ({
      ok: true,
      status: 200,
      body: sseStream([
        'event: token\ndata: {"text": "Hi"}\n\n',
        'event: done\ndata: {"model_used": "m"}\n\n',
      ]),
    }),
  });
  await withServer(router, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'u1' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const text = await res.text();
    assert.ok(text.includes('event: token') && text.includes('"text": "Hi"'));
    assert.ok(text.includes('event: done'));
  });
});

test('requires a signed-in user', async () => {
  const router = createAssistantChatRouter({ getJob: async () => undefined, openUpstream: okStream });
  await withServer(router, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 401);
  });
});

test('rejects an empty messages list', async () => {
  const router = createAssistantChatRouter({ getJob: async () => undefined, openUpstream: okStream });
  await withServer(router, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'u1' },
      body: JSON.stringify({ messages: [] }),
    });
    assert.equal(res.status, 400);
  });
});

test('builds ownership-checked job context from jobId', async () => {
  let captured: { context?: string } = {};
  const calls: Array<[string, string]> = [];
  const router = createAssistantChatRouter({
    getJob: async (userId, jobId) => {
      calls.push([userId, jobId]);
      return fakeJob();
    },
    openUpstream: async (payload) => {
      captured = payload as { context?: string };
      return okStream();
    },
  });
  await withServer(router, async (baseUrl) => {
    await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'u1' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'what am I missing?' }], jobId: 'job-1' }),
    });
  });
  assert.deepEqual(calls, [['u1', 'job-1']]);
  assert.ok(captured.context?.includes('Staff Engineer'));
  assert.ok(captured.context?.includes('Missing skills: Rust'));
});

test('omits context when the job is not found / not owned', async () => {
  let captured: { context?: string } = { context: 'sentinel' };
  const router = createAssistantChatRouter({
    getJob: async () => undefined,
    openUpstream: async (payload) => {
      captured = payload as { context?: string };
      return okStream();
    },
  });
  await withServer(router, async (baseUrl) => {
    await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'u1' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], jobId: 'nope' }),
    });
  });
  assert.equal(captured.context, undefined);
});

test('returns 502 when the upstream is unavailable', async () => {
  const router = createAssistantChatRouter({
    getJob: async () => undefined,
    openUpstream: async () => ({ ok: false, status: 503, body: null }),
  });
  await withServer(router, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'u1' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 503);
  });
});

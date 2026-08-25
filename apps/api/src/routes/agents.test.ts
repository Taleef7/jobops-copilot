import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { AgentDisabledError } from '@/lib/agent-client';
import { createAgentsRouter, type AgentsRouterDeps } from './agents';

function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

function erroringSseStream(frame: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(frame));
      setTimeout(() => controller.error(new Error('upstream details should stay private')), 0);
    },
  });
}

async function withServer(deps: Partial<AgentsRouterDeps>, run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    const userId = request.header('X-User-Id');
    if (userId) request.userId = userId;
    next();
  });
  app.use('/api/agents', createAgentsRouter({
    openStream: async () => ({ ok: true, status: 200, body: sseStream([]) }),
    openResume: async () => ({ ok: true, status: 200, body: sseStream([]) }),
    ...deps,
  }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const auth = { headers: { 'X-User-Id': 'u1' } };

test('agent stream requires a signed-in user', async () => {
  let calls = 0;
  await withServer({ openStream: async () => { calls += 1; return { ok: true, status: 200, body: sseStream([]) }; } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/feed-curator/stream`, { method: 'POST' });
    assert.equal(response.status, 401);
  });
  assert.equal(calls, 0);
});

test('unknown ids 404 without contacting upstream', async () => {
  let calls = 0;
  await withServer({ openStream: async () => { calls += 1; return { ok: true, status: 200, body: sseStream([]) }; } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/nope/stream`, { method: 'POST', ...auth });
    assert.equal(response.status, 404);
  });
  assert.equal(calls, 0);
});

test('disabled agent service maps to 503', async () => {
  await withServer({ openStream: async () => { throw new AgentDisabledError(); } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/feed-curator/stream`, { method: 'POST', ...auth });
    assert.equal(response.status, 503);
  });
});

test('stream maps body and pipes unbuffered SSE headers', async () => {
  let sent: unknown;
  await withServer({
    openStream: async (agentId, payload) => {
      sent = [agentId, payload];
      return { ok: true, status: 200, body: sseStream(['event: status\ndata: {"status":"done"}\n\n', 'event: result\ndata: {}\n\n']) };
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/feed-curator/stream`, {
      method: 'POST', headers: { ...auth.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: 'job-1', input: { q: 'python' } }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    assert.equal(response.headers.get('cache-control'), 'no-cache, no-transform');
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const text = await response.text();
    assert.match(text, /event: status/);
    assert.match(text, /event: result/);
  });
  assert.deepEqual(sent, ['feed-curator', { user_id: 'u1', job_id: 'job-1', input: { q: 'python' } }]);
});

test('stream emits a generic terminal error event when upstream fails after a frame', async () => {
  await withServer({
    openStream: async () => ({
      ok: true,
      status: 200,
      body: erroringSseStream('event: status\ndata: {"status":"running"}\n\n'),
    }),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/feed-curator/stream`, {
      method: 'POST',
      ...auth,
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /event: status/);
    assert.match(text, /event: error/);
    assert.match(text, /Agent stream failed/);
    assert.doesNotMatch(text, /upstream details should stay private/);
  });
});

test('stream preserves upstream non-OK status', async () => {
  await withServer({ openStream: async () => ({ ok: false, status: 429, body: null }) }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/feed-curator/stream`, { method: 'POST', ...auth });
    assert.equal(response.status, 429);
  });
});

test('stream returns 502 when an otherwise-successful upstream has no body', async () => {
  await withServer(
    { openStream: async () => ({ ok: true, status: 200, body: null }) },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/agents/feed-curator/stream`, {
        method: 'POST',
        ...auth,
      });
      assert.equal(response.status, 502);
    },
  );
});

test('resume validates thread tenancy and payload before upstream', async () => {
  let calls = 0;
  await withServer({ openResume: async () => { calls += 1; return { ok: true, status: 200, body: sseStream([]) }; } }, async (baseUrl) => {
    for (const threadId of ['', 'u1:feed-curatorx:evil', 'u10:feed-curator', 'other:feed-curator']) {
      const response = await fetch(`${baseUrl}/api/agents/feed-curator/resume`, {
        method: 'POST', headers: { ...auth.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId, payload: { approved: true } }),
      });
      assert.ok([400, 403].includes(response.status), `${threadId}: ${response.status}`);
    }
  });
  assert.equal(calls, 0);
});

test('resume requires a missing threadId and does not contact upstream', async () => {
  let calls = 0;
  await withServer(
    {
      openResume: async () => {
        calls += 1;
        return { ok: true, status: 200, body: sseStream([]) };
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/agents/feed-curator/resume`, {
        method: 'POST',
        headers: { ...auth.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: {} }),
      });
      assert.equal(response.status, 400);
    },
  );
  assert.equal(calls, 0);
});

test('resume accepts exact or job-scoped thread and forwards payload', async () => {
  let sent: unknown;
  await withServer({ openResume: async (agentId, payload) => { sent = [agentId, payload]; return { ok: true, status: 200, body: sseStream(['event: result\ndata: {}\n\n']) }; } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/resume-tailor/resume`, {
      method: 'POST', headers: { ...auth.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId: 'u1:resume-tailor:job-7', payload: { approved: true } }),
    });
    assert.equal(response.status, 200);
    await response.text();
  });
  assert.deepEqual(sent, ['resume-tailor', { thread_id: 'u1:resume-tailor:job-7', payload: { approved: true } }]);
});

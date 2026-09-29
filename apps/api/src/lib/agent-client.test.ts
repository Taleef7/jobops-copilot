import assert from 'node:assert/strict';
import test from 'node:test';
import { agentHeaders, isColdStartError, withColdStartWake, streamAgentUpstream, resumeAgentUpstream } from './agent-client';

function timeoutError() {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}

// agentHeaders reads AGENT_API_KEY lazily, so each case toggles the env directly (QA·A).
test('agentHeaders attaches a Bearer token when AGENT_API_KEY is set', () => {
  process.env.AGENT_API_KEY = 'sh4red-secret';
  try {
    const headers = agentHeaders({ 'Content-Type': 'application/json' });
    assert.equal(headers.Authorization, 'Bearer sh4red-secret');
    assert.equal(headers['Content-Type'], 'application/json');
  } finally {
    delete process.env.AGENT_API_KEY;
  }
});

test('agentHeaders omits Authorization when AGENT_API_KEY is unset', () => {
  delete process.env.AGENT_API_KEY;
  const headers = agentHeaders({ 'Content-Type': 'application/json' });
  assert.equal('Authorization' in headers, false);
  assert.equal(headers['Content-Type'], 'application/json');
});

test('agentHeaders works with no extra headers', () => {
  process.env.AGENT_API_KEY = 'k';
  try {
    assert.equal(agentHeaders().Authorization, 'Bearer k');
  } finally {
    delete process.env.AGENT_API_KEY;
  }
});

// A timed-out agent call is never re-sent (#345): the agent keeps billing after the client
// gives up. agent-client.no-retry.test.ts drives this against a fake agent.
test('isColdStartError is true only for timeout/abort errors', () => {
  assert.equal(isColdStartError(timeoutError()), true);
  const aborted = new Error('aborted');
  aborted.name = 'AbortError';
  assert.equal(isColdStartError(aborted), true);
  assert.equal(isColdStartError(new TypeError('fetch failed')), false);
  assert.equal(isColdStartError(new Error('agent /score-fit responded with 503')), false);
  assert.equal(isColdStartError('nope'), false);
});

test('withColdStartWake runs the paid call once and rethrows a timeout', async () => {
  let calls = 0;
  await assert.rejects(
    withColdStartWake(async () => {
      calls += 1;
      throw timeoutError();
    }),
    /timeout/,
  );
  assert.equal(calls, 1);
});

test('withColdStartWake returns a result and rethrows other errors untouched', async () => {
  assert.equal(await withColdStartWake(async () => 'real-result'), 'real-result');
  let calls = 0;
  await assert.rejects(
    withColdStartWake(async () => {
      calls += 1;
      throw new TypeError('connection refused');
    }),
    /connection refused/,
  );
  assert.equal(calls, 1);
});

test('specialist stream and resume clients URL-encode ids and send agent headers', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<[string, RequestInit]> = [];
  process.env.AGENT_SERVICE_URL = 'https://agent.example.test/';
  process.env.AGENT_API_KEY = 'key';
  globalThis.fetch = (async (input, init) => {
    calls.push([String(input), init ?? {}]);
    return new Response('event: result\\ndata: {}\\n\\n', { status: 200 });
  }) as typeof fetch;
  try {
    await streamAgentUpstream('feed curator', { user_id: 'u1' });
    await resumeAgentUpstream('resume/tailor', { thread_id: 'u1:resume/tailor', payload: {} });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.AGENT_SERVICE_URL;
    delete process.env.AGENT_API_KEY;
  }
  assert.equal(calls[0]?.[0], 'https://agent.example.test/agents/feed%20curator/stream');
  assert.equal(calls[1]?.[0], 'https://agent.example.test/agents/resume%2Ftailor/resume');
  assert.equal((calls[0]?.[1].headers as Record<string, string>).Authorization, 'Bearer key');
});

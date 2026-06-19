import assert from 'node:assert/strict';
import test from 'node:test';
import { agentHeaders, isColdStartError, withColdStartRetry } from './agent-client';

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

// Cold-start retry (QA·B): a timed-out agent call (scale-to-zero waking) retries once;
// a non-timeout error (e.g. connection refused) falls through to the mock immediately.
test('isColdStartError is true only for timeout/abort errors', () => {
  assert.equal(isColdStartError(timeoutError()), true);
  const aborted = new Error('aborted');
  aborted.name = 'AbortError';
  assert.equal(isColdStartError(aborted), true);
  assert.equal(isColdStartError(new TypeError('fetch failed')), false);
  assert.equal(isColdStartError(new Error('agent /score-fit responded with 503')), false);
  assert.equal(isColdStartError('nope'), false);
});

test('withColdStartRetry retries once after a timeout, then succeeds', async () => {
  const attempts: number[] = [];
  const result = await withColdStartRetry(async (attempt) => {
    attempts.push(attempt);
    if (attempt === 1) throw timeoutError();
    return 'real-result';
  });
  assert.equal(result, 'real-result');
  // op is invoked with attempt 1 then 2 (so the caller can shorten the retry budget).
  assert.deepEqual(attempts, [1, 2]);
});

test('withColdStartRetry does not retry a non-cold-start error', async () => {
  let calls = 0;
  await assert.rejects(
    withColdStartRetry(async () => {
      calls += 1;
      throw new TypeError('connection refused');
    }),
    /connection refused/,
  );
  assert.equal(calls, 1);
});

test('withColdStartRetry gives up after a second timeout (so the caller can mock)', async () => {
  let calls = 0;
  await assert.rejects(
    withColdStartRetry(async () => {
      calls += 1;
      throw timeoutError();
    }),
    /timeout/,
  );
  assert.equal(calls, 2);
});

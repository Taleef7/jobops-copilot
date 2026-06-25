import assert from 'node:assert/strict';
import test from 'node:test';
import { persistAgentRun } from './agent-output-store';

test('persistAgentRun saves with the model from the result', async () => {
  const calls: Array<{ userId: string; jobId: string; kind: string; payload: unknown; modelUsed?: string }> = [];
  const save = async (userId: string, jobId: string, kind: string, payload: unknown, modelUsed?: string) => {
    calls.push({ userId, jobId, kind, payload, modelUsed });
    return undefined;
  };

  await persistAgentRun('u1', 'job-1', 'research', { company_summary: 'x', model_used: 'gpt-z' }, save);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.kind, 'research');
  assert.equal(calls[0]?.modelUsed, 'gpt-z');
  assert.deepEqual(calls[0]?.payload, { company_summary: 'x', model_used: 'gpt-z' });
});

test('persistAgentRun swallows save failures (best-effort)', async () => {
  const save = async () => {
    throw new Error('db down');
  };
  // Must not reject.
  await persistAgentRun('u1', 'job-1', 'interview_prep', { likely_questions: [] }, save);
  assert.ok(true);
});

test('persistAgentRun skips a null/undefined result (no persist)', async () => {
  let called = false;
  const save = async () => {
    called = true;
    return undefined;
  };
  await persistAgentRun('u1', 'job-1', 'research', null, save);
  await persistAgentRun('u1', 'job-1', 'research', undefined, save);
  assert.equal(called, false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReadiness } from '@/routes/health';

test('computeReadiness: file mode is ready without a database check', () => {
  assert.deepEqual(computeReadiness('file', false), {
    statusCode: 200,
    body: { status: 'ready', mode: 'file', db: 'skipped' },
  });
});

test('computeReadiness: postgres reachable is ready (db ok)', () => {
  assert.deepEqual(computeReadiness('postgres', true), {
    statusCode: 200,
    body: { status: 'ready', mode: 'postgres', db: 'ok' },
  });
});

test('computeReadiness: postgres unreachable is not ready (503, db error)', () => {
  assert.deepEqual(computeReadiness('postgres', false), {
    statusCode: 503,
    body: { status: 'not_ready', mode: 'postgres', db: 'error' },
  });
});

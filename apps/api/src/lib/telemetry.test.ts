import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTelemetry } from '@/lib/telemetry';

test('startTelemetry is a no-op and returns false when no connection string is set', () => {
  const prev = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  try {
    assert.equal(startTelemetry(), false);
  } finally {
    if (prev !== undefined) process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = prev;
  }
});

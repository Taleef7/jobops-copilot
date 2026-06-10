import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAppInsights } from '@/lib/app-insights';

test('startAppInsights is a no-op and returns false when no connection string is set', () => {
  const prev = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  try {
    assert.equal(startAppInsights(), false);
  } finally {
    if (prev !== undefined) process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = prev;
  }
});

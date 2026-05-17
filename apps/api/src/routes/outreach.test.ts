import assert from 'node:assert/strict';
import test from 'node:test';
import { validateOutreachUpdateBody } from './outreach';

test('rejects an empty status string instead of treating it as missing', () => {
  const result = validateOutreachUpdateBody({ status: '' });

  assert.equal(result.normalized.status, undefined);
  assert.equal(result.errors.status, 'Invalid outreach status.');
});

test('trims and accepts a valid status', () => {
  const result = validateOutreachUpdateBody({ status: ' sent ' });

  assert.equal(result.normalized.status, 'sent');
  assert.deepEqual(result.errors, {});
});

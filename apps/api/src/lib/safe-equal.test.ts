import assert from 'node:assert/strict';
import test from 'node:test';
import { safeEqual } from './safe-equal';

test('matching secrets compare equal', () => {
  assert.equal(safeEqual('s3cr3t-value', 's3cr3t-value'), true);
});

test('differing secrets compare unequal', () => {
  assert.equal(safeEqual('s3cr3t-value', 's3cr3t-other'), false);
});

test('different lengths do not throw and compare unequal', () => {
  assert.equal(safeEqual('short', 'a-much-longer-secret'), false);
});

test('missing or empty inputs never match', () => {
  assert.equal(safeEqual(undefined, 'x'), false);
  assert.equal(safeEqual('x', undefined), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual(null, null), false);
});

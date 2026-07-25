import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_PAGE_LIMIT, paginateArray, parsePageParams } from './pagination';

test('absent limit means unbounded (backward-compatible)', () => {
  assert.deepEqual(parsePageParams({}), { limit: undefined, offset: 0 });
  assert.deepEqual(parsePageParams(undefined), { limit: undefined, offset: 0 });
});

test('a valid limit + offset are parsed', () => {
  assert.deepEqual(parsePageParams({ limit: '10', offset: '20' }), { limit: 10, offset: 20 });
});

test('limit is clamped to the ceiling; offset floored at 0', () => {
  assert.equal(parsePageParams({ limit: '10000' }).limit, MAX_PAGE_LIMIT);
  assert.equal(parsePageParams({ offset: '-5' }).offset, 0);
});

test('non-positive or malformed values fall back to defaults, never throw', () => {
  assert.equal(parsePageParams({ limit: '0' }).limit, undefined); // unbounded
  assert.equal(parsePageParams({ limit: 'abc' }).limit, undefined);
  assert.equal(parsePageParams({ limit: '1.5' }).limit, undefined);
  assert.equal(parsePageParams({ offset: 'nope' }).offset, 0);
});

test('repeated query params (arrays) take the first value', () => {
  assert.equal(parsePageParams({ limit: ['5', '9'] }).limit, 5);
});

test('paginateArray slices with limit/offset and never over-reads', () => {
  const items = [1, 2, 3, 4, 5];
  assert.deepEqual(paginateArray(items, { limit: 2, offset: 1 }), [2, 3]);
  assert.deepEqual(paginateArray(items, { limit: undefined, offset: 0 }), items);
  assert.deepEqual(paginateArray(items, { limit: 10, offset: 3 }), [4, 5]); // limit past the end
  assert.deepEqual(paginateArray(items, { limit: 2, offset: 99 }), []); // offset past the end
});

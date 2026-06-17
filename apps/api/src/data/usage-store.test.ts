import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { addUsage, getTodayUsage, resetUsageStoreForTests } from './usage-store';

afterEach(() => resetUsageStoreForTests());

test('accumulates per-user spend and call count for today', async () => {
  await addUsage('user_1', 0.02);
  await addUsage('user_1', 0.03);

  const today = await getTodayUsage('user_1');
  assert.equal(today.calls, 2);
  assert.ok(Math.abs(today.costUsd - 0.05) < 1e-9, `expected ~0.05, got ${today.costUsd}`);
});

test('usage is scoped per user', async () => {
  await addUsage('user_1', 0.04);
  assert.deepEqual(await getTodayUsage('user_2'), { costUsd: 0, calls: 0 });
});

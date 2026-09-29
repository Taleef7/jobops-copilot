import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { adjustDailyUsage, getTodayUsage, reserveDailyBudget, resetUsageStoreForTests } from './usage-store';

async function withTempStore(run: () => Promise<void>) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-usage-'));
  try {
    process.chdir(tempDir);
    resetUsageStoreForTests();
    await run();
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

test('reserveDailyBudget accrues spend and reports it via getTodayUsage', async () => {
  await withTempStore(async () => {
    assert.deepEqual(await reserveDailyBudget('user_1', 1, 0.02), { allowed: true, costUsd: 0.02 });
    await reserveDailyBudget('user_1', 1, 0.03);

    const today = await getTodayUsage('user_1');
    assert.equal(today.calls, 2);
    assert.ok(Math.abs(today.costUsd - 0.05) < 1e-9, `expected ~0.05, got ${today.costUsd}`);
    assert.deepEqual(await getTodayUsage('user_2'), { costUsd: 0, calls: 0 });
  });
});

test('reserveDailyBudget never lets spend pass the ceiling (#345)', async () => {
  await withTempStore(async () => {
    assert.equal((await reserveDailyBudget('user_1', 0.05, 0.04)).allowed, true); // 0.04
    assert.equal((await reserveDailyBudget('user_1', 0.05, 0.04)).allowed, false); // would be 0.08
    assert.equal((await reserveDailyBudget('user_1', 0.05, 0.01)).allowed, true); // exactly 0.05
    assert.equal((await reserveDailyBudget('user_1', 0.05, 0.01)).allowed, false);
    assert.equal((await getTodayUsage('user_1')).calls, 2);
  });
});

test('a zero ceiling is a kill switch: even the first call of the day is refused', async () => {
  await withTempStore(async () => {
    assert.equal((await reserveDailyBudget('user_new', 0, 0.01)).allowed, false);
    assert.deepEqual(await getTodayUsage('user_new'), { costUsd: 0, calls: 0 });
  });
});

test('concurrent reservations are serialized and cannot overshoot the ceiling', async () => {
  await withTempStore(async () => {
    // ceiling 0.05, cost 0.02: 0.02 and 0.04 fit; a third would make 0.06.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveDailyBudget('user_race', 0.05, 0.02)),
    );
    const allowed = results.filter((r) => r.allowed).length;
    assert.equal(allowed, 2);
    assert.equal((await getTodayUsage('user_race')).calls, 2);
  });
});

test('adjustDailyUsage refunds a reservation or charges extra, never below zero', async () => {
  await withTempStore(async () => {
    await reserveDailyBudget('user_1', 1, 0.01);
    await reserveDailyBudget('user_1', 1, 0.01);
    await adjustDailyUsage('user_1', -0.01, -1); // refund one
    let usage = await getTodayUsage('user_1');
    assert.equal(usage.calls, 1);
    assert.ok(Math.abs(usage.costUsd - 0.01) < 1e-9);
    await adjustDailyUsage('user_1', 0.05, 0); // a large input cost more than reserved
    usage = await getTodayUsage('user_1');
    assert.ok(Math.abs(usage.costUsd - 0.06) < 1e-9);
    await adjustDailyUsage('user_1', -5, -5);
    assert.deepEqual(await getTodayUsage('user_1'), { costUsd: 0, calls: 0 });
    // No row for the day: nothing to refund, nothing created.
    await adjustDailyUsage('user_none', -0.01, -1);
    assert.deepEqual(await getTodayUsage('user_none'), { costUsd: 0, calls: 0 });
  });
});

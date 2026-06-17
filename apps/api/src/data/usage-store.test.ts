import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { getTodayUsage, reserveDailyBudget, resetUsageStoreForTests } from './usage-store';

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

test('reserveDailyBudget blocks once the ceiling is reached', async () => {
  await withTempStore(async () => {
    assert.equal((await reserveDailyBudget('user_1', 0.05, 0.04)).allowed, true); // 0.04
    assert.equal((await reserveDailyBudget('user_1', 0.05, 0.04)).allowed, true); // 0.08, crossed
    assert.equal((await reserveDailyBudget('user_1', 0.05, 0.04)).allowed, false); // already over
  });
});

test('concurrent reservations are serialized and cannot overshoot the ceiling', async () => {
  await withTempStore(async () => {
    // ceiling 0.05, cost 0.02 → reservations allowed while pre-value < 0.05: at 0, 0.02, 0.04.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveDailyBudget('user_race', 0.05, 0.02)),
    );
    const allowed = results.filter((r) => r.allowed).length;
    assert.equal(allowed, 3);
    assert.equal((await getTodayUsage('user_race')).calls, 3);
  });
});

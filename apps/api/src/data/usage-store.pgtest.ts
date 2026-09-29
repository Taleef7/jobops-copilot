import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { adjustDailyUsage, getTodayUsage, reserveDailyBudget } from './usage-store';

// Runs only against a real, ephemeral Postgres (see the `db` CI job). The Postgres store
// used to insert the first row of the day without checking the ceiling, so
// AI_DAILY_BUDGET_USD=0 let each user's first call through (#345).
const DB = process.env.DATABASE_URL?.trim();

test(
  'Postgres budget: a zero ceiling refuses everything, no reservation passes the ceiling, refunds clamp at zero',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async () => {
    const killed = `itest_budget_kill_${randomUUID().slice(0, 8)}`;
    assert.equal((await reserveDailyBudget(killed, 0, 0.01)).allowed, false);
    assert.deepEqual(await getTodayUsage(killed), { costUsd: 0, calls: 0 });

    const user = `itest_budget_${randomUUID().slice(0, 8)}`;
    assert.equal((await reserveDailyBudget(user, 0.05, 0.04)).allowed, true);
    assert.equal((await reserveDailyBudget(user, 0.05, 0.04)).allowed, false); // would be 0.08
    assert.equal((await reserveDailyBudget(user, 0.05, 0.01)).allowed, true); // exactly 0.05
    assert.deepEqual(await getTodayUsage(user), { costUsd: 0.05, calls: 2 });

    await adjustDailyUsage(user, -0.01, -1);
    assert.deepEqual(await getTodayUsage(user), { costUsd: 0.04, calls: 1 });
    await adjustDailyUsage(user, -1, -5);
    assert.deepEqual(await getTodayUsage(user), { costUsd: 0, calls: 0 });

    const absent = `itest_budget_none_${randomUUID().slice(0, 8)}`;
    await adjustDailyUsage(absent, -0.01, -1);
    assert.deepEqual(await getTodayUsage(absent), { costUsd: 0, calls: 0 });
  },
);

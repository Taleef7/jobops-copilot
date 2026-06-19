import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyBudgetUsd } from './cost';

const original = process.env.AI_DAILY_BUDGET_USD;
function restore() {
  if (typeof original === 'undefined') delete process.env.AI_DAILY_BUDGET_USD;
  else process.env.AI_DAILY_BUDGET_USD = original;
}

test('defaults to 1.0 when unset', () => {
  delete process.env.AI_DAILY_BUDGET_USD;
  try {
    assert.equal(dailyBudgetUsd(), 1.0);
  } finally {
    restore();
  }
});

test('uses a valid configured value', () => {
  process.env.AI_DAILY_BUDGET_USD = '2.5';
  try {
    assert.equal(dailyBudgetUsd(), 2.5);
  } finally {
    restore();
  }
});

test('fails safe to the default on malformed values (no fail-open)', () => {
  try {
    for (const bad of ['', '   ', 'abc', 'NaN', 'Infinity', '-1']) {
      process.env.AI_DAILY_BUDGET_USD = bad;
      assert.equal(dailyBudgetUsd(), 1.0, `expected default for ${JSON.stringify(bad)}`);
    }
  } finally {
    restore();
  }
});

test('preserves a deliberate 0 as a block-all kill-switch', () => {
  process.env.AI_DAILY_BUDGET_USD = '0';
  try {
    // 0 is a valid operational state: the store denies on `current >= 0`, so the
    // first call of the day is blocked. It must NOT silently revert to the default cap.
    assert.equal(dailyBudgetUsd(), 0);
  } finally {
    restore();
  }
});

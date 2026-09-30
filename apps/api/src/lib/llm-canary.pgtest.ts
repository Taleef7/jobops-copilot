import assert from 'node:assert/strict';
import test from 'node:test';
import { getLlmCanaryResult, saveLlmCanaryResult } from './llm-canary';
import { getPool } from './postgres';

// #348: the last canary result lives in cache_entries, so every API instance serves the
// same one on /api/status. Runs only against a real, ephemeral Postgres (the `db` CI job).
const DB = process.env.DATABASE_URL?.trim();

test(
  'the last canary result is kept in Postgres, replaced by the next run, and expires',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async () => {
    const pool = getPool();
    assert.ok(pool);
    await pool.query("delete from cache_entries where key = 'llm-canary:last'");
    assert.equal(await getLlmCanaryResult(), null);

    const passed = { ok: true, model: 'gpt-5.4-nano', latencyMs: 812, error: null, checkedAt: '2026-09-30T10:00:00.000Z' };
    await saveLlmCanaryResult(passed);
    assert.deepEqual(await getLlmCanaryResult(), passed);

    const failed = { ok: false, model: 'gpt-6-luna', latencyMs: null, error: 'not supported', checkedAt: '2026-10-01T10:00:00.000Z' };
    await saveLlmCanaryResult(failed);
    assert.deepEqual(await getLlmCanaryResult(), failed);

    const { rows } = await pool.query<{ days: number }>(
      "select round(extract(epoch from (expires_at - now())) / 86400)::int as days from cache_entries where key = 'llm-canary:last'",
    );
    assert.equal(rows[0]?.days, 30);

    await pool.query("update cache_entries set expires_at = now() - interval '1 second' where key = 'llm-canary:last'");
    assert.equal(await getLlmCanaryResult(), null, 'an expired result is not served');
  },
);

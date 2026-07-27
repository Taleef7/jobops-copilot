import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReadiness } from '@/routes/health';

test('computeReadiness: file mode is ready without a database check', () => {
  assert.deepEqual(computeReadiness('file', false, { state: 'skipped' }), {
    statusCode: 200,
    body: { status: 'ready', mode: 'file', db: 'skipped', migrations: 'skipped' },
  });
});

test('computeReadiness: postgres reachable and migrated is ready (db ok)', () => {
  assert.deepEqual(computeReadiness('postgres', true, { state: 'ok' }), {
    statusCode: 200,
    body: { status: 'ready', mode: 'postgres', db: 'ok', migrations: 'ok' },
  });
});

test('computeReadiness: postgres unreachable is not ready (503, db error)', () => {
  assert.deepEqual(computeReadiness('postgres', false, { state: 'unknown', reason: 'x' }), {
    statusCode: 503,
    body: { status: 'not_ready', mode: 'postgres', db: 'error', migrations: 'unknown' },
  });
});

// The regression this whole change exists for: production ran nine migrations
// behind and every probe stayed green, because a read against a missing table
// returns an empty result rather than an error.
test('computeReadiness: reachable but behind on migrations is NOT ready', () => {
  assert.deepEqual(
    computeReadiness('postgres', true, {
      state: 'pending',
      pending: ['008_agent_outputs.sql', '010_scale_stores.sql'],
    }),
    {
      statusCode: 503,
      body: {
        status: 'not_ready',
        mode: 'postgres',
        db: 'ok',
        migrations: 'pending',
        pending: ['008_agent_outputs.sql', '010_scale_stores.sql'],
      },
    },
  );
});

// Deliberately lenient: an unreadable schema_migrations must not flap the probe
// and have App Service restart a working API. The deploy gate requires
// migrations == "ok", so this still blocks a ship.
test('computeReadiness: unknown migration state stays ready but is reported', () => {
  assert.deepEqual(
    computeReadiness('postgres', true, { state: 'unknown', reason: 'schema_migrations unreadable' }),
    {
      statusCode: 200,
      body: { status: 'ready', mode: 'postgres', db: 'ok', migrations: 'unknown' },
    },
  );
});

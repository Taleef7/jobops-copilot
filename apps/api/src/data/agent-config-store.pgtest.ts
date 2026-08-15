import assert from 'node:assert/strict';
import test from 'node:test';
import { getPool } from '@/lib/postgres';
import {
  activateAgentConfigVersion,
  insertAgentConfigVersion,
  listAgentConfigs,
} from '@/data/agent-config-store';

// Real-Postgres only (named *.pgtest.ts so `npm test` skips it; run via `npm run test:pg`).
// The one-active-row invariant lives in a partial unique index, so only a live database can
// prove it: a fake query fn will happily accept a swap that Postgres would reject.
const DB = process.env.DATABASE_URL?.trim();

const AGENT = 'feed-curator' as const;

test(
  'agent_configs: seeded tiering, version insert/repoint, and the one-active invariant',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async (t) => {
    const pool = getPool();
    assert.ok(pool, 'expected a live pool');

    async function activeCount(agentId: string): Promise<number> {
      const { rows } = await pool!.query<{ count: string }>(
        'select count(*)::text as count from agent_configs where agent_id = $1 and active',
        [agentId],
      );
      return Number(rows[0]!.count);
    }

    try {
      await t.test('the migration seeds exactly one active config per agent', async () => {
        const { rows } = await pool.query<{ agent_id: string; actives: string }>(
          `select agent_id, count(*) filter (where active)::text as actives
             from agent_configs group by agent_id order by agent_id`,
        );
        assert.equal(rows.length, 4, 'expected the four specialist agents to be seeded');
        for (const row of rows) {
          assert.equal(row.actives, '1', `${row.agent_id} must have exactly one active config`);
        }
      });

      await t.test('inserting a version activates it and deactivates the previous one', async () => {
        const version = await insertAgentConfigVersion(AGENT, 'openai:gpt-5.6-luna', { temperature: 0.1 }, {});
        assert.ok(version >= 2, 'expected a version above the seeded v1');
        assert.equal(await activeCount(AGENT), 1);

        const configs = await listAgentConfigs(AGENT);
        assert.equal(configs[0]?.version, version, 'newest version comes first');
        assert.equal(configs[0]?.active, true);
        assert.equal(configs[0]?.model, 'openai:gpt-5.6-luna');
        assert.deepEqual(configs[0]?.params, { temperature: 0.1 });
        assert.equal(configs.find((config) => config.version === 1)?.active, false);
      });

      await t.test('repointing active to an older version rolls the model back', async () => {
        assert.equal(await activateAgentConfigVersion(AGENT, 1), true);
        assert.equal(await activeCount(AGENT), 1);
        const configs = await listAgentConfigs(AGENT);
        assert.equal(configs.find((config) => config.active)?.version, 1);
      });

      await t.test('repointing to a missing version changes nothing and reports false', async () => {
        assert.equal(await activateAgentConfigVersion(AGENT, 9_999), false);
        assert.equal(await activeCount(AGENT), 1, 'a failed repoint must not leave the agent unconfigured');
        const configs = await listAgentConfigs(AGENT);
        assert.equal(configs.find((config) => config.active)?.version, 1);
      });
    } finally {
      // Restore the seeded state: drop the versions this test added, keep v1 active.
      await pool.query('delete from agent_configs where agent_id = $1 and version > 1', [AGENT]);
      await pool.query('update agent_configs set active = true where agent_id = $1 and version = 1', [AGENT]);
    }
  },
);

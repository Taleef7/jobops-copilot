import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createAgentConfigRouter } from './agent-config';
import type { AgentConfigDeps } from './agent-config';
import type { AgentConfigRecord } from '@/data/agent-config-store';

async function withServer(
  deps: Partial<AgentConfigDeps>,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    const header = request.header('X-User-Id');
    if (header) request.userId = header.trim();
    next();
  });
  app.use(
    '/api/agents',
    createAgentConfigRouter({
      hasDb: () => true,
      listConfigs: async () => [],
      activateVersion: async () => false,
      insertVersion: async () => 1,
      ...deps,
    }),
  );
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('no server address');
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const authed = { headers: { 'X-User-Id': 'u1' } };

function jsonPut(body: unknown) {
  return {
    method: 'PUT',
    headers: { 'X-User-Id': 'u1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const sampleConfigs: AgentConfigRecord[] = [
  {
    agentId: 'feed-curator',
    version: 2,
    model: 'openai:gpt-5.6-luna',
    params: {},
    promptOverrides: {},
    active: true,
    createdAt: '2026-08-15T00:00:00.000Z',
  },
  {
    agentId: 'feed-curator',
    version: 1,
    model: 'anthropic:claude-haiku-4-5',
    params: { temperature: 0.2 },
    promptOverrides: {},
    active: false,
    createdAt: '2026-08-14T00:00:00.000Z',
  },
];

test('GET /api/agents/:agentId/config requires a signed-in user', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/feed-curator/config`);
    assert.equal(response.status, 401);
  });
});

test('GET /api/agents/:agentId/config 404s an unknown agent id', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/nope/config`, authed);
    assert.equal(response.status, 404);
  });
});

test('GET /api/agents/:agentId/config 503s without a database', async () => {
  await withServer({ hasDb: () => false }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/feed-curator/config`, authed);
    assert.equal(response.status, 503);
  });
});

test('GET /api/agents/:agentId/config returns the active config and every version', async () => {
  await withServer({ listConfigs: async () => sampleConfigs }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/feed-curator/config`, authed);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      active: AgentConfigRecord | null;
      versions: AgentConfigRecord[];
    };
    assert.equal(body.active?.version, 2);
    assert.equal(body.active?.model, 'openai:gpt-5.6-luna');
    assert.equal(body.versions.length, 2);
  });
});

test('GET /api/agents/:agentId/config reports a null active config when none is active', async () => {
  await withServer(
    { listConfigs: async () => sampleConfigs.map((config) => ({ ...config, active: false })) },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/agents/feed-curator/config`, authed);
      assert.equal(response.status, 200);
      const body = (await response.json()) as { active: AgentConfigRecord | null };
      assert.equal(body.active, null);
    },
  );
});

test('PUT /api/agents/:agentId/config repoints active to an existing version', async () => {
  const calls: Array<[string, number]> = [];
  await withServer(
    {
      activateVersion: async (agentId, version) => {
        calls.push([agentId, version]);
        return true;
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/agents/feed-curator/config`, jsonPut({ version: 1 }));
      assert.equal(response.status, 200);
      const body = (await response.json()) as { activeVersion: number };
      assert.equal(body.activeVersion, 1);
      assert.deepEqual(calls, [['feed-curator', 1]]);
    },
  );
});

test('PUT /api/agents/:agentId/config 404s repointing to a version that does not exist', async () => {
  await withServer({ activateVersion: async () => false }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/feed-curator/config`, jsonPut({ version: 99 }));
    assert.equal(response.status, 404);
  });
});

test('PUT /api/agents/:agentId/config inserts and activates a new version from { model }', async () => {
  const calls: unknown[] = [];
  await withServer(
    {
      insertVersion: async (agentId, model, params, promptOverrides) => {
        calls.push([agentId, model, params, promptOverrides]);
        return 3;
      },
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/agents/resume-tailor/config`,
        jsonPut({ model: 'openai:gpt-5.6-luna', params: { temperature: 0.1 } }),
      );
      assert.equal(response.status, 201);
      const body = (await response.json()) as { activeVersion: number };
      assert.equal(body.activeVersion, 3);
      assert.deepEqual(calls, [['resume-tailor', 'openai:gpt-5.6-luna', { temperature: 0.1 }, {}]]);
    },
  );
});

test('PUT /api/agents/:agentId/config 400s a model without a provider prefix', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/resume-tailor/config`, jsonPut({ model: 'no-colon' }));
    assert.equal(response.status, 400);
  });
});

test('PUT /api/agents/:agentId/config 400s a body that is neither a version nor a model', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/resume-tailor/config`, jsonPut({ nonsense: true }));
    assert.equal(response.status, 400);
  });
});

test('PUT /api/agents/:agentId/config 400s a non-integer version', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/resume-tailor/config`, jsonPut({ version: 1.5 }));
    assert.equal(response.status, 400);
  });
});

test('PUT /api/agents/:agentId/config requires a signed-in user', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/feed-curator/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    });
    assert.equal(response.status, 401);
  });
});

test('PUT /api/agents/:agentId/config 503s without a database', async () => {
  await withServer({ hasDb: () => false }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agents/feed-curator/config`, jsonPut({ version: 1 }));
    assert.equal(response.status, 503);
  });
});

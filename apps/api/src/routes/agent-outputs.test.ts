import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createAgentOutputsRouter } from './agent-outputs';
import type { AgentOutputRecord } from '@/data/agent-output-store';
import type { JobRecord } from '@/types';

async function withServer(
  mount: (app: express.Express) => void,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    const header = request.header('X-User-Id');
    if (header) request.userId = header.trim();
    next();
  });
  mount(app);
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

const fakeJob = { id: 'job-1' } as unknown as JobRecord;
const sampleOutputs: AgentOutputRecord[] = [
  { jobId: 'job-1', kind: 'research', payload: { company_summary: 'x' }, modelUsed: 'm', createdAt: '2026-06-24T00:00:00.000Z' },
];

function mountRouter(deps: {
  getJob: (userId: string, jobId: string) => Promise<JobRecord | undefined>;
  list: (userId: string, jobId: string) => Promise<AgentOutputRecord[]>;
}) {
  return (app: express.Express) =>
    app.use('/api/jobs', createAgentOutputsRouter({ getJob: deps.getJob, listAgentOutputs: deps.list }));
}

test('GET /api/jobs/:id/agent-outputs requires a signed-in user', async () => {
  await withServer(
    mountRouter({ getJob: async () => fakeJob, list: async () => sampleOutputs }),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/jobs/job-1/agent-outputs`);
      assert.equal(response.status, 401);
    },
  );
});

test('GET /api/jobs/:id/agent-outputs returns the saved outputs', async () => {
  await withServer(
    mountRouter({ getJob: async () => fakeJob, list: async () => sampleOutputs }),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/jobs/job-1/agent-outputs`, {
        headers: { 'X-User-Id': 'u1' },
      });
      assert.equal(response.status, 200);
      const body = await response.json() as { outputs: AgentOutputRecord[] };
      assert.equal(body.outputs.length, 1);
      assert.equal(body.outputs[0]?.kind, 'research');
    },
  );
});

test('GET /api/jobs/:id/agent-outputs 404s for an unowned job', async () => {
  await withServer(
    mountRouter({ getJob: async () => undefined, list: async () => sampleOutputs }),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/jobs/job-9/agent-outputs`, {
        headers: { 'X-User-Id': 'u1' },
      });
      assert.equal(response.status, 404);
    },
  );
});

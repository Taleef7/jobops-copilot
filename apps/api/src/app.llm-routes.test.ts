import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import type express from 'express';
import { createApp } from './app';

/**
 * Route inventory (#345): every route that can reach the AI agent sits behind the strict
 * limiter, and every one that doesn't reserve its own budget sits behind the budget guard.
 * The injected guards block with a tag, so a response proves which guard ran first.
 */

type Guard = 'limiter' | 'budget';
const block = (tag: Guard): express.RequestHandler => (_request, response) => {
  response.status(429).json({ guard: tag });
};
const pass: express.RequestHandler = (_request, _response, next) => next();

async function withApp(deps: Parameters<typeof createApp>[0], run: (baseUrl: string) => Promise<void>) {
  const server = http.createServer(createApp(deps));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// [method, path, budget]: 'guard' means the budget middleware must run; 'own' means the
// route reserves budget itself right before its agent call (telemetry, discovery).
const LLM_ROUTES: Array<[string, string, 'guard' | 'own']> = [
  ['POST', '/api/ai/parse-job', 'guard'],
  ['POST', '/api/ai/score-fit', 'guard'],
  ['POST', '/api/ai/draft-outreach', 'guard'],
  ['POST', '/api/ai/agents/interview-prep', 'guard'],
  ['POST', '/api/ai/agents/research', 'guard'],
  ['POST', '/api/ai/agents/skill-gap', 'guard'],
  ['POST', '/api/ai/assistant/run', 'guard'],
  ['POST', '/api/ai/assistant/resume', 'guard'],
  ['POST', '/api/ai/assistant/stream', 'guard'],
  ['POST', '/api/ai/assistant/chat', 'guard'],
  ['POST', '/api/agents/feed-curator/stream', 'guard'],
  ['POST', '/api/agents/feed-curator/resume', 'guard'],
  // Express matches paths case-insensitively, so the guard must too.
  ['POST', '/api/agents/feed-curator/STREAM', 'guard'],
  ['POST', '/api/agents/feed-curator/Resume/', 'guard'],
  ['POST', '/api/profile/base-resume/parse-resume', 'guard'],
  ['POST', '/api/contacts/00000000-0000-0000-0000-000000000000/draft-outreach', 'guard'],
  ['POST', '/api/Contacts/00000000-0000-0000-0000-000000000000/Draft-Outreach', 'guard'],
  ['GET', '/api/telemetry/insights', 'own'],
  ['GET', '/api/telemetry/ev-demo', 'own'],
  ['POST', '/api/discovery/run', 'own'],
];

// Cheap but abusable routes (no LLM): strict limiter only.
const STRICT_ONLY_ROUTES: Array<[string, string]> = [
  ['POST', '/api/jobs/extract'],
  ['POST', '/api/profile/base-resume/render-pdf'],
  ['POST', '/api/notifications/test'],
  ['POST', '/api/profile/resume'],
];

const auth = { 'X-User-Id': 'u_inventory', 'Content-Type': 'application/json' };

async function guardFor(baseUrl: string, method: string, path: string): Promise<string | null> {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: auth, body: method === 'GET' ? undefined : '{}' });
  if (response.status !== 429) return null;
  const body = (await response.json().catch(() => ({}))) as { guard?: string };
  return body.guard ?? null;
}

test('every LLM route and every abusable route is behind the strict limiter', async () => {
  await withApp({ runLimiter: block('limiter'), runBudget: pass }, async (baseUrl) => {
    for (const [method, path] of [...LLM_ROUTES, ...STRICT_ONLY_ROUTES]) {
      assert.equal(await guardFor(baseUrl, method, path), 'limiter', `${method} ${path} must be rate limited`);
    }
  });
});

test('every LLM route without its own reservation is behind the budget guard', async () => {
  await withApp({ runLimiter: pass, runBudget: block('budget') }, async (baseUrl) => {
    for (const [method, path, budget] of LLM_ROUTES) {
      if (budget !== 'guard') continue;
      assert.equal(await guardFor(baseUrl, method, path), 'budget', `${method} ${path} must reserve AI budget`);
    }
  });
});

test('reads and config writes on the same prefixes are not charged', async () => {
  await withApp({ runLimiter: block('limiter'), runBudget: block('budget') }, async (baseUrl) => {
    for (const [method, path] of [
      ['GET', '/api/agents/feed-curator/config'],
      ['PUT', '/api/agents/feed-curator/config'],
    ]) {
      assert.equal(await guardFor(baseUrl, method!, path!), null, `${method} ${path} must not be charged`);
    }
  });
});

test('every route module that can call the AI agent is in the inventory above', () => {
  // Route modules that reach the agent: they import the agent client or the discovery
  // sweep (which scores jobs through it). Exceptions are listed with the reason.
  const covered = new Set([
    'ai.ts', 'assistant.ts', 'assistant-chat.ts', 'agents.ts', 'base-resume.ts', 'contacts.ts',
    'telemetry.ts', 'discovery.ts',
  ]);
  const exempt: Record<string, string> = {
    'health.ts': 'pings the agent /health for /api/status; no LLM call (A00 #348 makes it private)',
    'n8n.ts': 'secret-authenticated webhook; reserves the n8n user budget itself',
    'internal.ts': 'secret-authenticated cron; each user budget is reserved per scored job',
  };
  const dir = join(__dirname, 'routes');
  const reaching = readdirSync(dir)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .filter((file) => /from '@\/lib\/(agent-client|discovery)'/.test(readFileSync(join(dir, file), 'utf8')));
  for (const file of reaching) {
    assert.ok(covered.has(file) || file in exempt, `routes/${file} can call the AI agent but is not in the inventory`);
  }
});

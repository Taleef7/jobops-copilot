import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

/**
 * #345: a timed-out agent call must never be sent again. The agent keeps working (and
 * billing) after the client gives up, so a retry pays twice. Instead the client wakes the
 * scale-to-zero container with a free GET /health and fails.
 */
test('a timeout on any paid agent call produces exactly one POST and one /health wake-up', async () => {
  const counts = new Map<string, number>();
  const server = http.createServer((request, response) => {
    const key = `${request.method} ${request.url}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}');
      return;
    }
    request.resume();
    // Slower than the client's timeout, like a cold container.
    setTimeout(() => {
      if (!response.writableEnded) response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    }, 800);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');

  const saved = { ...process.env };
  process.env.AGENT_SERVICE_URL = `http://127.0.0.1:${address.port}`;
  process.env.AGENT_TIMEOUT_MS = '150';
  process.env.AGENT_TASK_TIMEOUT_MS = '150';
  try {
    // Imported after the env is set: the timeouts are read at module load.
    const client = await import('./agent-client');
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['POST /parse-job', () => client.resolveParsedJob('A job')],
      ['POST /score-fit', () => client.resolveFitScore({ descriptionText: 'A job', resumeText: 'Me', profileText: 'Me' })],
      ['POST /parse-resume', () => client.resolveResumeParse('My résumé')],
      ['POST /assistant/stream', () => client.streamAssistantUpstream({})],
      ['POST /assistant/chat', () => client.streamAssistantChatUpstream({})],
      ['POST /agents/feed-curator/stream', () => client.streamAgentUpstream('feed-curator', {})],
      ['POST /agents/feed-curator/resume', () => client.resumeAgentUpstream('feed-curator', {})],
    ];
    for (const [key, call] of calls) {
      const wakesBefore = counts.get('GET /health') ?? 0;
      // The resolvers fall back (A2 removes the mock); the stream openers throw.
      await call().catch(() => undefined);
      assert.equal(counts.get(key), 1, `${key} must be sent once, not retried`);
      assert.equal(counts.get('GET /health'), wakesBefore + 1, `${key} timeout must wake the agent with /health`);
    }
  } finally {
    process.env = saved;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

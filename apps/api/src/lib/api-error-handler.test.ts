import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { apiErrorHandler } from './api-error-handler';

// A body that isn't JSON, or is JSON null, is the client's mistake: 400, not 500 (#415).
test('a body that is not valid JSON, or JSON null, is a 400', async () => {
  const app = express();
  app.use(express.json());
  app.patch('/layout', (request, response) => {
    response.json({ received: request.body ?? null });
  });
  app.use(apiErrorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const send = (body: string) =>
    fetch(`http://127.0.0.1:${port}/layout`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
  try {
    for (const body of ['{"sections": [', 'null', 'not json']) {
      const response = await send(body);
      assert.equal(response.status, 400, body);
      assert.match(((await response.json()) as { error: string }).error, /JSON/, body);
    }
    assert.equal((await send('{"pageSize":"a4"}')).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
